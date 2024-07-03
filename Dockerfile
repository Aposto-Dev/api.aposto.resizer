FROM amazonlinux:2023

# Install dependencies
RUN yum -y install gcc-c++ make libjpeg-turbo libjpeg-turbo-devel libpng libpng-devel libtiff libtiff-devel

# Install Node.js 18
RUN curl --silent --location https://rpm.nodesource.com/setup_18.x | bash -
RUN yum -y install nodejs
RUN npm install --global yarn
RUN yum -y install zip
# create directories
RUN mkdir /app /build

# copy source code
COPY ./app/* /app/

# install npm dependencies
WORKDIR /app
RUN yarn install
RUN yarn add sharp --ignore-engines

# build app
WORKDIR /app
RUN zip -r /build/build.zip .

# put container to sleep in order to copy the build
CMD sleep 10m
