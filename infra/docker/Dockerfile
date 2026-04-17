FROM node:22-alpine

WORKDIR /app

# Install Python and pdfplumber system deps
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

RUN mkdir -p uploads

CMD ["node", "dist/index.js"]
