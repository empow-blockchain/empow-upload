require('dotenv').config();
const express = require('express')
const app = express();
const PORT = 5000

const bodyParser = require("body-parser");
const mkdirp = require('mkdirp');
const cors = require('cors');

const path = require('path')
const fs = require('fs');
const multer = require('multer');
const upload = multer();
const ffmpeg = require('fluent-ffmpeg');
const { uploadIpfs, getPhotoSize, resizePhoto, appendPhoto, downloadFile, convertVideoType, getVideoDimension, resizeVideo, generateThumbnail } = require("./utils")
mkdirp('./uploads')

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

app.options('*', cors())

const init = async () => {
    app.get('/', (req, res) => {
        return res.send('test 13');
    });

    app.post('/uploadGif', upload.single('file'), uploadGif)
    app.post('/uploadPhoto', upload.single('file'), uploadPhoto)
    app.post('/uploadVideo', upload.single('file'), uploadVideo)

    app.listen(PORT, () =>
        console.log(`Example app listening on port ${PORT}!`),
    );
}

async function uploadGif(req, res) {
    if (req.file.mimetype !== "image/gif") {
        res.status(500)
        return res.send("File not correct format")
    }

    const fileName = req.file.originalname
    const pathUpload = path.resolve(__dirname, '../uploads')
    const pathFile = pathUpload + '/' + fileName
    const pathFileMp4 = pathUpload + "/" + fileName + ".mp4"
    fs.writeFileSync(pathFile, req.file.buffer)

    ffmpeg(pathFile).outputOptions([
        '-movflags faststart',
        '-pix_fmt yuv420p',
        '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'
    ])
        .inputFormat('gif')
        .on('end', function () {
            fs.readFile(pathFileMp4, async function (err, mp4Buffer) {
                const url = await uploadIpfs(mp4Buffer)
                fs.unlink(pathFile, () => { return })
                fs.unlink(pathFileMp4, () => { return })
                res.send(url)
            });
        }).save(pathFileMp4)
}

async function uploadPhoto(req, res) {
    if (req.file.mimetype !== "image/png" && req.file.mimetype !== "image/jpeg") {
        res.status(500)
        return res.send("File not correct format")
    }

    if (!req.query.size) {
        res.status(500)
        return res.send("Error size")
    }

    let sizeOriginal;

    try {
        sizeOriginal = await getPhotoSize(req.file.buffer)
    } catch(err) {
        return res.status(500).send(err + "")
    }

    const { width, height } = sizeOriginal
    const ratio = width / height

    var result = {}

    var checkPoint = []
    var listSize = JSON.parse(req.query.size)

    for (let i = 0; i < listSize.length; i++) {
        let widthResize = listSize[i]
        result[`dataResize${widthResize}`] = null
        checkPoint.push(widthResize)

        if (width > widthResize || height > widthResize) {
            // default: resize follow width
            let newWidth = widthResize
            let newHeight = parseInt(newWidth / ratio)

            // if width > height (ratio  1) resize follow height
            if (req.query.resizeHeight && ratio < 1) {
                newHeight = widthResize
                newWidth = parseInt(widthResize * ratio)
            }

            const newSize = {
                width: newWidth,
                height: newHeight
            }

            if (req.query.noWatermask) {
                var file = await resizePhoto(req.file.buffer, newSize, req.file.mimetype === "image/jpeg" ? "JPG" : "PNG")
                result[`dataResize${widthResize}`] = await uploadIpfs(file)
            } else {
                var file = await appendPhoto(req.file.buffer, req.file.originalname, newSize, req.file.mimetype === "image/jpeg" ? "JPG" : "PNG", true)
                result[`dataResize${widthResize}`] = await uploadIpfs(file)
            }
        } else {
            if (req.query.noWatermask) {
                const url = await uploadIpfs(req.file.buffer)
                result[`dataResize${widthResize}`] = url
            } else {
                var file = await appendPhoto(req.file.buffer, req.file.originalname, sizeOriginal, req.file.mimetype === "image/jpeg" ? "JPG" : "PNG", false)
                result[`dataResize${widthResize}`] = await uploadIpfs(file)
            }
        }
    }

    var interval = setInterval(() => {
        if (checkPoint.length === 0) {
            return;
        }
        for (let j = 0; j < checkPoint.length; j++) {
            const widthResize = checkPoint[j]
            if (!result[`dataResize${widthResize}`]) {
                return;
            }
        }

        clearInterval(interval)
        res.send(result)
    }, 100)
}

async function uploadVideo(req, res) {
    var fileName, url, size;

    if (req.body.link) {
        fileName = await downloadFile(req.body.link)
        var newfileName = await convertVideoType(fileName)
        url = await uploadIpfs(newfileName)
        size = await getVideoDimension(newfileName)
    } else {
        if (req.file.mimetype !== "video/mp4" && req.file.mimetype !== "video/x-flv" && req.file.mimetype !== "video/x-msvideo" && req.file.mimetype !== "video/quicktime") {
            res.status(500)
            return res.send("File not correct format")
        }
        const pathUpload = path.resolve(__dirname, '../uploads')
        fileName = pathUpload + "/" + req.file.originalname
        const pathFile = pathUpload + '/' + req.file.originalname
        let buffer = req.file.buffer
        fs.writeFileSync(pathFile, buffer)

        // check to resize
        size = await getVideoDimension(fileName)

        const { width, height } = size
        if (width > 720 || height > 720) {
            const ratio = width / height

            size.width = 720
            size.height = Math.floor(720 / ratio)

            if (width < height) {
                size.width = Math.floor(720 * ratio)
                size.height = 720
            }

            const oldFileName = fileName
            fileName = await resizeVideo(fileName, size.width)
            fs.unlinkSync(oldFileName)
            size = await getVideoDimension(fileName)
            url = await uploadIpfs(fileName)
        } else {
            if (req.file.mimetype === "video/mp4") {
                url = await uploadIpfs(buffer)
            } else {
                var newfileName = await convertVideoType(fileName)
                url = await uploadIpfs(newfileName)
            }

        }
    }

    try {
        const { thumbPath, thumbUrl } = await generateThumbnail(fileName)

        var result = {
            size,
            thumbnail: thumbUrl,
            url
        }

        res.send(result)
        fs.unlinkSync(fileName)
        fs.unlinkSync(thumbPath)

    } catch (err) {
        console.log(err)
        res.status(500).send("Can't get data")
    }
}

init()