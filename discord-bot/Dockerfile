FROM node:20-alpine
RUN apk add --no-cache font-noto
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY . .
CMD ["node", "index.js"]
