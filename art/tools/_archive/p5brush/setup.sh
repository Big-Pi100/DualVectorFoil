#!/bin/sh
# 拉取上游 p5.brush（MIT）。只在首次或需要更新时跑。
# 上游 29MB，只在出图时用，不入库（.deps/ 已 gitignore）。
set -e
cd "$(dirname "$0")/../../.."
mkdir -p .deps
[ -d .deps/p5.brush ] || git clone --depth 1 https://github.com/acamposuribe/p5.brush.git .deps/p5.brush
echo "p5.brush ready at .deps/p5.brush"
