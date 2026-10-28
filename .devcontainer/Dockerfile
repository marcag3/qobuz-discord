FROM node:26-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    git \
    openssh-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

USER node
