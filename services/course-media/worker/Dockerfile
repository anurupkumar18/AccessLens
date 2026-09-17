# Course media worker: Node 22 plus the native tools that make any upload
# accessible. Built by CodeBuild during `cdk deploy` (see
# infra/lib/course-media-stack.ts), so nobody deploying needs Docker locally.
#
# Debian rather than the AWS Lambda base image: LibreOffice, poppler, libheif
# and ffmpeg are one apt-get here and a from-source build on Amazon Linux 2023.
# Pulled from the ECR Public mirror of the official images, which is not subject
# to Docker Hub's anonymous pull limits on shared CodeBuild hosts.

FROM public.ecr.aws/docker/library/node:22-bookworm AS runtime-interface
WORKDIR /ric
RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ make cmake autoconf automake libtool python3 unzip libcurl4-openssl-dev \
 && npm init -y >/dev/null \
 && npm install aws-lambda-ric@3

FROM public.ecr.aws/docker/library/node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-impress-nogui libreoffice-writer-nogui libreoffice-calc-nogui \
      fonts-liberation2 fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core \
      poppler-utils ffmpeg imagemagick libheif-examples librsvg2-bin libcurl4 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /function
COPY --from=runtime-interface /ric/node_modules ./node_modules
COPY dist/index.mjs ./index.mjs

# Lambda's filesystem is read-only outside /tmp; LibreOffice writes its profile under HOME.
ENV HOME=/tmp
ENTRYPOINT ["/function/node_modules/.bin/aws-lambda-ric"]
CMD ["index.handler"]
