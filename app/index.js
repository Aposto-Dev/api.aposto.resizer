'use strict'

const AWS = require('aws-sdk');
const Sharp = require('sharp');

const S3 = new AWS.S3({ signatureVersion: 'v4' });
const PathPattern = /(.*\/)?(.*)\/(.*)/;

// environment variables
const {BUCKET, URL} = process.env;
const WHITELIST = process.env.WHITELIST
    ? Object.freeze(process.env.WHITELIST.split(' '))
    : null;

const fitOptions = [
    'cover',    // Preserving aspect ratio, ensure the image covers both provided dimensions by cropping/clipping to fit. (default)
    'contain',  // Preserving aspect ratio, contain within both provided dimensions using "letterboxing" where necessary.
    'fill',     // Ignore the aspect ratio of the input and stretch to both provided dimensions.
    'inside',   // Preserving aspect ratio, resize the image to be as large as possible while ensuring its dimensions are less than or equal to both those specified.
    'outside',  // Preserving aspect ratio, resize the image to be as small as possible while ensuring its dimensions are greater than or equal to both those specified.
];

exports.handler = async (event) => {
    const path = event.queryStringParameters.path;
    const parts = PathPattern.exec(path);
    const dir = parts[1] || '';
    const resizeOption = parts[2];  // e.g. "150x150_max"
    const sizeAndAction = resizeOption.split('_');
    const filename = parts[3];

    const sizes = sizeAndAction[0].split("x");
    const action = sizeAndAction.length > 1 ? sizeAndAction[1] : null;

    // Whitelist validation.
    if (WHITELIST && !WHITELIST.includes(resizeOption)) {
        return {
            statusCode: 400,
            body: `WHITELIST is set but does not contain the size parameter "${resizeOption}"`,
            headers: { 'Content-Type': 'text/plain' }
        };
    }

    // Fit validation
    if(action && (fitOptions.indexOf(action) === -1)) {
        return {
            statusCode: 400,
            body: `Unknown Fit action parameter "${action}"\n` +
                `Available Fit action: ${fitOptions.join(', ')}.`,
            headers: { 'Content-Type': 'text/plain' }
        };
    }

    try {
        const data = await S3.getObject({
                Bucket: BUCKET,
                Key: dir + filename
            })
            .promise();

        const width = sizes[0] === 'AUTO' ? null : parseInt(sizes[0]);
        const height = sizes[1] === 'AUTO' ? null : parseInt(sizes[1]);
        const fit = action || 'cover';

        const result = await Sharp(data.Body, { failOnError: false })
            .resize(width, height, { withoutEnlargement: true, fit })
            .rotate()
            .toBuffer();

        await S3.putObject({
            Body: result,
            Bucket: BUCKET,
            ContentType: data.ContentType,
            Key: path,
            CacheControl: 'public, max-age=86400'
        }).promise();

        return {
            statusCode: 301,
            headers: {'Location': `${URL}/${path}`}
        };
    }
    catch(e) {
        return {
            statusCode: e.statusCode || 400,
            body: 'Exception: ' + e.message,
            headers: {'Content-Type': 'text/plain'}
        };
    }
}