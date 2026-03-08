FROM node:20-alpine

# ffmpeg-static bundles the binary, but alpine needs these libs for it to run
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "--dns-result-order=ipv4first", "index.js"]
