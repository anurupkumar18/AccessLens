# Headless Chromium harness Lambda image. The viewer's opaque-origin sandbox remains
# the execution boundary; this image only supplies the browser process and S3 adapter.
FROM public.ecr.aws/lambda/nodejs:22

# Chromium is installed from the Amazon Linux package repository. Keep the
# package set explicit so image growth is reviewable and no network/runtime SDK
# is introduced into the artifact sandbox.
RUN dnf install -y \
      chromium \
      ca-certificates \
      fontconfig \
      dejavu-sans-fonts \
    && dnf clean all \
    && rm -rf /var/cache/dnf

COPY package.json ${LAMBDA_TASK_ROOT}/package.json
RUN npm install --ignore-scripts --no-audit --no-fund

COPY services/harness ${LAMBDA_TASK_ROOT}/services/harness
COPY services/agents ${LAMBDA_TASK_ROOT}/services/agents
COPY services/shared ${LAMBDA_TASK_ROOT}/services/shared
COPY apps/extension/src/shared ${LAMBDA_TASK_ROOT}/apps/extension/src/shared
COPY tests/evals ${LAMBDA_TASK_ROOT}/tests/evals

RUN npm install --no-save --ignore-scripts --no-audit --no-fund \
      @aws-sdk/client-s3@3.1133.0 esbuild@0.28.2 \
    && npx esbuild ${LAMBDA_TASK_ROOT}/services/harness/handler.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --outfile=${LAMBDA_TASK_ROOT}/index.mjs \
      --packages=bundle \
    && rm -rf node_modules package.json package-lock.json services apps tests

ENV CHROMIUM_PATH=/usr/bin/chromium
CMD ["index.handler"]
