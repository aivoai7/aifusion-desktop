# 占位用：让 `docker compose up` 在控制台还没写完时也能起来。
# 真控制台（管理端 + 登录 + 计费看板）写在这个目录里，构建产物替换掉这份 http.server。
# 选 python 的静态服务只是为了零配置监听 3000，跟 Caddyfile 的 upstream 对齐。
FROM python:3.12-alpine
WORKDIR /app
COPY index.html /app/index.html
EXPOSE 3000
CMD ["python", "-m", "http.server", "--bind", "0.0.0.0", "3000"]
