#!/bin/bash

# Ensure a file path is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <input-file-path>"
    exit 1
fi

INPUT_PATH=$1
OUTPUT_PATH="./resized-output.gif"

# Create a temporary Node.js script to resize the GIF
cat << 'EOF' > testSharp.js
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

// Define the resize options
const width = 600;  // Set desired width
const height = null; // Set desired height
const fit = 'cover'; // Set the fit option

async function resizeGif() {
    try {
        // Read the input file
        const originalImageBody = fs.readFileSync(inputPath);

        // Resize the GIF while preserving animation
        const result = await sharp(originalImageBody, { animated: true })
            .resize(width, height, { withoutEnlargement: false, fit })
            .toBuffer();

        // Save the resized image to the output path
        fs.writeFileSync(outputPath, result);

        console.log('Image resized successfully:', outputPath);
    } catch (err) {
        console.error('Error resizing image:', err);
    }
}

resizeGif();
EOF

node testSharp.js "$INPUT_PATH" "$OUTPUT_PATH"

rm testSharp.js
