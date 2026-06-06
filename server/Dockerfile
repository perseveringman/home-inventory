# 后端 AI 代理镜像
# build context 必须是仓库根：docker build -f server/Dockerfile .
#
# 国内拉镜像优化：
#   - 用阿里云 alpine 镜像源（apk 加速）
#   - 用腾讯云 npm 镜像（虽然 server 现在没有依赖，将来加进来才用得上）

FROM node:20-alpine AS runtime

# 阿里云 apk 镜像（如服务器拉不动改成腾讯云: mirrors.tencentyun.com）
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache wget tini

WORKDIR /app

# 只拷需要的东西，保持镜像小
COPY server/package.json /app/server/package.json
COPY server/server.js   /app/server/server.js
COPY api                /app/api

# server 当前零依赖；预留 npm install 步骤以便未来加包
# 用腾讯云镜像源（如不在国内可注释掉）
RUN cd /app/server \
    && npm config set registry https://mirrors.tencent.com/npm/ \
    && npm install --omit=dev --no-audit --no-fund || true

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1

WORKDIR /app/server
# tini 作为 PID 1 处理信号转发与僵尸进程
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
