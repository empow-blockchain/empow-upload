require('dotenv').config({ path: '../.env' });

const ipfsAPI = require('ipfs-http-client')
const ipfs = ipfsAPI({ host: process.env.IPFS_HOST, port: '5001', protocol: 'http' })
const gm = require('gm')
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path')
const request = require('request')
const Jimp = require("jimp")

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const exec = require('child_process').exec;

function randomString(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function getPhotoSize(buffer) {
    return new Promise((resolve, reject) => {
        Jimp.read(buffer).then(image => {
            resolve({
                width: image.bitmap.width,
                height: image.bitmap.height
            })
        }).catch(err => reject(err))
    })
}

function uploadIpfs(file) {
    return new Promise((resolve, reject) => {

        if (typeof file === "string")
            file = fs.readFileSync(file)

        ipfs.add(file, (err, result) => {
            if (err) {
                reject(err)
            }

            resolve(process.env.IPFS_GATEWAY + result[0].hash)
        })
    })
}

function resizePhoto(buffer, newSize, mimetype) {
    return new Promise((resolve, reject) => {
        gm(buffer)
            .autoOrient()
            .resize(newSize.width, newSize.height)
            .toBuffer(mimetype, async (err, gmBuffer) => {
                if (err) {
                    reject(err)
                }

                resolve(gmBuffer)
            })
    })
}

function appendPhoto(buffer, originalname, newSize, mimetype, resize = true) {
    return new Promise(async (resolve, reject) => {
        if(resize) {
            buffer = await resizePhoto(buffer, newSize, mimetype)
        }

        var fileNameMask = path.resolve(__dirname, "../watermask.png")
        var resizeMask = false
        var newNameMask = randomString(32)

        if (newSize.width < 670) {
            const bufferMask = fs.readFileSync(fileNameMask)
            let sizeMask;
            try {
                sizeMask = await getPhotoSize(bufferMask)
            } catch(err) {
                reject(err)
            }
           
            const ratioMask = sizeMask.width / sizeMask.height

            const newSizeMask = {
                width: newSize.width,
                height: parseInt(newSize.width / ratioMask)
            }

            var newMask = await resizePhoto(bufferMask, newSizeMask, 'png')
            fileNameMask = path.resolve(__dirname, `../${newNameMask}.png`)
            fs.writeFileSync(fileNameMask, newMask)
            resizeMask = true
        }

        gm(buffer, originalname)
            .append(fileNameMask)
            .toBuffer(mimetype, async (err, gmBuffer) => {
                if (err) {
                    if (resizeMask) fs.unlinkSync(fileNameMask)
                    reject(err)
                }

                if (resizeMask) fs.unlinkSync(fileNameMask)
                resolve(gmBuffer)
            })
    })
}

function convertVideoType(fileName, ext = 'mp4') {
    return new Promise((resolve, reject) => {
        const newFileName = path.resolve(__dirname, "../uploads") + `/${randomString(10)}.${ext}`
        let command = ffmpeg(fileName);
        command.clone()
            .save(newFileName)
            .on("end", async (stdout, stderr) => {
                resolve(newFileName)
            })
    })
}

module.exports = {
    uploadIpfs: uploadIpfs,
    randomString: randomString,
    resizePhoto: resizePhoto,
    appendPhoto: appendPhoto,
    convertVideoType: convertVideoType,
    getPhotoSize: getPhotoSize,
    async generateThumbnail(fileName) {
        return new Promise(async (resolve, reject) => {

            const time = "00:00:00"
            const size = " "
            // size = ' -y -s ' + "670x?";
            const thumbPath = path.resolve(__dirname, "../uploads") + `/${randomString(10)}.jpg`
            exec(ffmpegPath +' -ss ' + time + ' -i "' + fileName + '"' + size + ' -vframes 1 -f image2 "' + thumbPath +'"', async err => {
                if (err) {
                    return reject(err)
                }

                const thumbBuffer = fs.readFileSync(thumbPath)
                const thumbUrl = await uploadIpfs(thumbBuffer)

                resolve({ thumbPath, thumbUrl })
            });
        })
    },

    downloadFile(uri) {
        return new Promise(async (resolve, reject) => {
            const handler = request(uri)
            handler.on("response", res => {
                const extension = res.headers['content-type'].split('/')[1]
                if (extension !== "mp4" && extension !== "flv" && extension !== "avi" && extension !== "mov") return reject("file not correct format")
                const fileName = path.resolve(__dirname, "../uploads") + `/${randomString(10)}.` + extension
                res.pipe(fs.createWriteStream(fileName)).on("close", () => resolve(fileName))
            })
        })
    },

    getVideoDimension(video) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(video, (err, metadata) => {
                if (err) return reject(err);

                const stream = metadata.streams.find(
                    stream => stream.codec_type === "video"
                );

                resolve({
                    width: stream.width,
                    height: stream.height
                });
            });
        });
    },

    resizeVideo(fileName, width, ext = 'mp4') {
        return new Promise((resolve, reject) => {
            const newFileName = path.resolve(__dirname, "../uploads") + `/${randomString(10)}.${ext}`
            let command = ffmpeg(fileName);
            command.clone()
                .size(width + 'x?')
                .save(newFileName)
                .on("end", async (stdout, stderr) => {
                    resolve(newFileName)
                })
        })
    },
}