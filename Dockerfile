FROM oven/bun:alpine

WORKDIR /app

COPY index.ts tsconfig.json ./

CMD ["bun", "index.ts"]
