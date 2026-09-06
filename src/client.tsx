import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";

/**
 * 客户端入口保持极薄：真正的产品 UI 分散在 `src/app/*`。
 *
 * 旧 Cloudflare Assistant 示例曾把两千多行 Kumo Demo 全堆在这个文件；
 * Family AI 改为 AI Elements + shadcn 后，入口只负责挂载 React。
 */
function detectRenderingMode(): "hardware" | "software" {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "software";

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER)
    ).toLowerCase();

    if (
      renderer.includes("swiftshader") ||
      renderer.includes("llvmpipe") ||
      renderer.includes("software") ||
      renderer.includes("basic render driver") ||
      renderer.includes("warp")
    ) {
      return "software";
    }

    return "hardware";
  } catch {
    return "software";
  }
}

// Family AI 默认保留 AI Elements / shadcn 的毛玻璃视觉；只有浏览器已经掉进
// SwiftShader/WARP/纯软件渲染时才自动关闭 backdrop-filter，避免软件合成整屏像素。
// 这是能力降级，不是永久阉割 UI：Chrome 恢复硬件合成后刷新页面就会自动恢复效果。
document.documentElement.dataset.renderingMode = detectRenderingMode();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
