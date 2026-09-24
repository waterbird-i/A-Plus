import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相对路径：同一份 dist 既能放 GitHub Pages 的子路径，也能直接塞 itch.io 的 zip 根目录。
  // Babylon 的 shader 分块也是相对的，所以不用为每个托管方各出一版。
  base: './',
  server: { open: false },
  build: {
    target: 'es2022',
    // 生产构建不产 sourcemap：它让 dist 从约 2 MB 涨到约 30 MB（map 占 90%+），
    // 而 dist 是发布 / 给真人测试的产物，不需要它。要按源码定位用 npm run dev。
    sourcemap: false,
    // 全部代码一个 chunk 是量过的结论，不是偷懒：
    //   · 深导入后总量 1.59 MB（gzip 401 KB）
    //   · 按 vendor 拆开反而涨到 1.97 + 0.18 MB（gzip 455 + 63 KB）——
    //     跨 chunk 边界后打包器不能再去掉块间共享的死代码，多出来的比省下的多
    //   · 而且 Babylon 是开屏就要的，拆开只多一次请求瀑布
    // 阈值调到它的上面，是为了让这条「已量过」的结论不被当成警告忽略掉。
    chunkSizeWarningLimit: 1800,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
