# Use Node 18 Alpine
FROM node:18-alpine

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all code
COPY . .

# Expose port 5173 (Vite default)
EXPOSE 5173

# Start Vite dev server
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

