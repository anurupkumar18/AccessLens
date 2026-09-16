# Lambda's Node 22 base is Amazon Linux 2023. LibreOffice is intentionally
# installed in this image rather than a Lambda layer: the authoring stage is
# isolated from the extension and can tolerate a large, infrequent cold start.
FROM public.ecr.aws/lambda/nodejs:22


# Poppler is available in AL2023. LibreOffice's upstream RPM bundle is used
# because the Lambda base does not ship an Office package. Pin the bundle URL;
# update it deliberately when the office runtime is upgraded.
ARG LIBREOFFICE_VERSION=26.8.0
ARG LIBREOFFICE_ARCH=x86_64
RUN dnf install -y \
      poppler-utils \
      ca-certificates \
      tar \
      gzip \
      findutils \
      wget \
      xorg-x11-server-Xvfb \
      cups-libs \
      libXinerama \
      libXrandr \
      libXrender \
      libXext \
      libSM \
      libICE \
      fontconfig \
      freetype \
      dejavu-sans-fonts \
    && dnf clean all \
    && rm -rf /var/cache/dnf \
    && mkdir -p /tmp/libreoffice \
    && wget --no-verbose --https-only \
      "https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/rpm/${LIBREOFFICE_ARCH}/LibreOffice_${LIBREOFFICE_VERSION}_Linux_x86-64_rpm.tar.gz" \
      -O /tmp/libreoffice.tar.gz \
    && tar -xzf /tmp/libreoffice.tar.gz -C /tmp/libreoffice --strip-components=1 \
    # dnf5 (the package manager on the current AL2023 Lambda base) rejects
    # local RPM paths as if they were package specs: "No package matches
    # '/tmp/libreoffice/RPMS/...rpm'". The bundle is self-contained under
    # /opt and its X11/font dependencies are installed above, so install it
    # the way LibreOffice documents: with rpm itself.
    && rpm -Uvh --nodeps /tmp/libreoffice/RPMS/*.rpm \
    && SOFFICE_PATH="$(find /opt /usr -type f -path '*/program/soffice' -print -quit)" \
    && test -n "${SOFFICE_PATH}" \
    && ln -s "${SOFFICE_PATH}" /usr/local/bin/soffice \
    && rm -rf /tmp/libreoffice /tmp/libreoffice.tar.gz

COPY package.json ${LAMBDA_TASK_ROOT}/package.json
# pngjs is currently a repository devDependency because the browser build also
# owns the image toolchain. Install the complete pinned package set while
# bundling, then remove node_modules so no package is required at runtime.
RUN npm install --ignore-scripts --no-audit --no-fund

# esbuild is used only while assembling the image. Keeping the handler as one
# bundle avoids shipping the full repository and gives Lambda a stable module.
# Preserve the repository-relative paths because the portable source imports
# services/shared and apps/extension directly.
COPY services/ingest/src ${LAMBDA_TASK_ROOT}/services/ingest/src
# The course-library indexer (services/library) rides in the same image: it
# needs the same LibreOffice and Poppler, and the function is selected by
# the CMD override in infra (library.handler), not by a second image build.
COPY services/library/src ${LAMBDA_TASK_ROOT}/services/library/src
COPY services/shared ${LAMBDA_TASK_ROOT}/services/shared
COPY apps/extension/src/sources/screen ${LAMBDA_TASK_ROOT}/apps/extension/src/sources/screen
COPY apps/extension/src/shared ${LAMBDA_TASK_ROOT}/apps/extension/src/shared
RUN npm install --no-save --ignore-scripts --no-audit --no-fund \
      @aws-sdk/client-s3@3.1133.0 @aws-sdk/client-s3vectors@3.1133.0 \
      @aws-sdk/client-bedrock-runtime@3.1133.0 @aws-sdk/client-dynamodb@3.1133.0 \
      @aws-sdk/lib-dynamodb@3.1133.0 esbuild@0.28.2 \
    # CommonJS, not ESM: the AWS SDK's bundled internals call require() for
    # node:https and friends, and an ESM bundle answers that with "Dynamic
    # require of \"node:https\" is not supported" at cold start -- which is
    # exactly how the first deployed job died. The root package.json (type:
    # module) is removed below, so index.js is read as CommonJS.
    && npx esbuild ${LAMBDA_TASK_ROOT}/services/ingest/src/handler.ts \
      --bundle --platform=node --format=cjs --target=node22 \
      --outfile=${LAMBDA_TASK_ROOT}/index.js \
      --packages=bundle \
    && npx esbuild ${LAMBDA_TASK_ROOT}/services/library/src/handler.ts \
      --bundle --platform=node --format=cjs --target=node22 \
      --outfile=${LAMBDA_TASK_ROOT}/library.js \
      --packages=bundle \
    && rm -rf node_modules package.json package-lock.json services apps

CMD ["index.handler"]
