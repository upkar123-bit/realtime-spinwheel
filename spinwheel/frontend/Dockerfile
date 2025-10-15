FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --production
COPY . .
ENV PORT=5173
CMD ["npm","run","preview","--","--port","5173","--host"]
