FROM oven/bun:1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
COPY libs ./libs
RUN bun install --frozen-lockfile

COPY index.ts tsconfig.json ./
COPY src ./src
COPY certs/41610792.pfx ./certs/41610792.pfx

CMD ["bun", "run", "start"]
