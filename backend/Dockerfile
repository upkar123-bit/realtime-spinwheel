FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=4000
CMD ["node","src/index.js"]
