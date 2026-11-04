FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
ffmpeg python3 curl ca-certificates \
&& rm -rf /var/lib/apt/lists/*

# Change this number to force Render to re-download yt-dlp
ARG CACHEBUST=1
RUN echo "cachebust=$CACHEBUST" \
&& curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
&& chmod a+rx /usr/local/bin/yt-dlp \
&& yt-dlp --version

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

CMD ["node", "index.js"]