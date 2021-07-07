'use strict';

const AWS = require('aws-sdk');
const Sharp = require('sharp');
const fs = require('fs')

const S3 = new AWS.S3({ signatureVersion: 'v4' });

// environment variables
const BUCKET = process.env.BUCKET;
const WHITELISTED_DIMENSIONS = process.env.WHITELISTED_DIMENSIONS
    ? Object.freeze(process.env.WHITELISTED_DIMENSIONS.split(' '))
    : null;

const DEFAULT_CACHE_HEADER = 'public, max-age=86400';
const FIT_OPTIONS = [
    'cover',    // Preserving aspect ratio, ensure the image covers both provided dimensions by cropping/clipping to fit. (default)
    'contain',  // Preserving aspect ratio, contain within both provided dimensions using "letterboxing" where necessary.
    'fill',     // Ignore the aspect ratio of the input and stretch to both provided dimensions.
    'inside',   // Preserving aspect ratio, resize the image to be as large as possible while ensuring its dimensions are less than or equal to both those specified.
    'outside',  // Preserving aspect ratio, resize the image to be as small as possible while ensuring its dimensions are greater than or equal to both those specified.
    'shadow',   // Unrealted to aspect ratio. This one adds a drop shadow to a PNG image.
];

function getResource(resourcePath) {

    let params = {
        Bucket: BUCKET,
        Key: resourcePath
    };

    return new Promise((resolve, reject) => {
        S3.getObject(params, (err, data) => {
            if(err) {
                return resolve(false);
            }
            if(data) {
                return resolve(data);
            }
        })
    });
}

function saveResource(resourcePath) {
    try {    
        let params = {
            Bucket: BUCKET,
            Key: resourcePath
        };
        return new Promise((resolve, reject) => {
            S3.getObject(params, (err, data) => {
                if (err) {
                    return reject(err)
                }
                fs.writeFileSync(`./temp/${resourcePath}`, data.Body)
                return resolve(`./temp/${resourcePath}`)
            })
        })
    } catch (err) {
        return Promise.reject(err)
    }
}

exports.handler = async (event) => {
    const pathParameters = event.pathParameters;
    const path = pathParameters.proxy || pathParameters[Object.keys(pathParameters)[0]];
    let parts = path.split('/');
    const resizeOption = parts.shift();
    const sizeAndAction = resizeOption.split('_');
    const filename = parts.join('/');
    const sizes = sizeAndAction[0].split('x');
    const action = sizeAndAction.length > 1 ? sizeAndAction[1] : 'cover';

    const allowedMimeTypes = [
        'image/jpeg',
        'image/gif',
        'image/png',
        'image/svg+xml',
        'image/tiff',
        'image/bmp'
    ];

    const unsupportedSharpMimeTypes = [
        'image/bmp',
        'audio/mp3', 
        'audio/mpeg'
    ];

    // validate requested image dimension against whitelisted dimensions.
    if (WHITELISTED_DIMENSIONS && !WHITELISTED_DIMENSIONS.includes(sizeAndAction[0])) {
        return {
            statusCode: 400,
            body: `WHITELIST is set but does not contain the size parameter "${sizeAndAction[0]}"`,
            headers: { 'Content-Type': 'text/plain' }
        };
    }

    // Fit validation
    if(action && (FIT_OPTIONS.indexOf(action) === -1)) {
        return {
            statusCode: 400,
            body: `Unknown Fit action parameter "${action}"\n` +
                `Available Fit actions: ${FIT_OPTIONS.join(', ')}.`,
            headers: { 'Content-Type': 'text/plain' }
        };
    }

    // check if a resized option exists.
    let existingResized = await getResource(path);
    if(existingResized) {
        // if a resized option exists, return it.
        return {
            statusCode: 200,
            body: (Buffer.from(existingResized.Body)).toString('base64'),
            isBase64Encoded: true,
            headers: {
                'Content-Type': existingResized.ContentType,
                'Cache-Control': DEFAULT_CACHE_HEADER
            }
        };
    }

    // load original image.
    let originalImage = await getResource(filename);

    // check if image does not exist.
    if(!originalImage) {
        // return 404.
        return {
            statusCode: 404,
            body: `Resource not found. Could not find resource: ${filename}.`,
            headers: {
                'Content-Type': 'text/plain',
                'Cache-Control': 'private, nocache'
            }
        };
    }

    const originalImageMime = originalImage.ContentType;
    if(!allowedMimeTypes.includes(originalImageMime)) {
        // return 400.
        return {
            statusCode: 400,
            body: `Unsupported MIME type: ${originalImageMime}. Supported types: ${allowedMimeTypes.join(', ')}`,
            headers: {
                'Content-Type': 'text/plain',
                'Cache-Control': 'private, nocache'
            }
        };
    }

    // handle unsupported Sharp images
    if(unsupportedSharpMimeTypes.includes(originalImageMime)) {
        return {
            statusCode: 200,
            body: (Buffer.from(originalImage.Body)).toString('base64'),
            isBase64Encoded: true,
            headers: {
                'Content-Type': originalImageMime,
                'Cache-Control': DEFAULT_CACHE_HEADER,
                'Age': 0
            }
        };
    }

    const width = sizes[0] === 'auto' ? null : parseInt(sizes[0]);
    const height = sizes[1] === 'auto' ? null : parseInt(sizes[1]);
    if (width > 3840 || height > 2160) return {
        statusCode: 400,
        body: "Go away!",
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': DEFAULT_CACHE_HEADER,
            'Age': 0
        }
    }
    const fit = action || 'cover';

    let result;
    let newPath;

    if (fit === 'shadow') {
        // create a new image with white shadow. The original script is:
        //      $ convert $1  \
        //      > \( -clone 0 -background white -shadow 100x3+0+0 \) \
        //      > -reverse -background none -layers merge +repage shadowed_$1
        const { exec } = require('child_process')
        const filepath = await saveResource(filename)
        exec(`sh ./add_drop_shadow.sh ${filepath}`, (error, stdout, stderr) => {
            console.log(stdout)
            console.log(stderr)
            if (error !== null) {
                console.log(`exec error: ${error}`)
            }
        })
        result = fs.readFileSync(filepath)
        newPath = `shadowed/${path}`
    } else {
        // create a new image using provided dimensions.
        result = await Sharp(originalImage.Body, { failOnError: false })
            .resize(width, height, { withoutEnlargement: false, fit })
            .rotate()
            .toBuffer();
        newPath = path
    }

    // save newly created image to S3.
    await S3.putObject({
        Body: result,
        Bucket: BUCKET,
        ContentType: originalImageMime,
        Key: newPath,
        CacheControl: DEFAULT_CACHE_HEADER
    }).promise();


    // return created image as a response.
    return {
        statusCode: 200,
        body: result.toString('base64'),
        isBase64Encoded: true,
        headers: {
            'Content-Type': originalImageMime,
            'Cache-Control': DEFAULT_CACHE_HEADER,
            'Age': 0
        }
    };
}
