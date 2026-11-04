FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
ffmpeg curl ca-certificates \
&& rm -rf /var/lib/apt/lists/*

# standalone binary: មាន Python និង JS solver (yt-dlp-ejs) ភ្ជាប់មកជាមួយ
ARG CACHEBUST=1
RUN echo "cachebust=$CACHEBUST" \
&& curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
&& chmod a+rx /usr/local/bin/yt-dlp \
&& yt-dlp --version

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# មិនប្រើ yt-dlp -U ទៀត (GitHub rate limit)
CMD ["node", "index.js"]