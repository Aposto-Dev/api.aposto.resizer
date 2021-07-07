#!/bin/bash
echo "Filepath is $1"
convert ./temp/$1  \
\( -clone 0 -background white -shadow 100x3+0+0 \) \
-reverse -background none -layers merge +repage ./temp/shadowed_$1
