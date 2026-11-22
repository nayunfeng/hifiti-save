# 本项目验证

- 本项目是 JavaScript 油猴脚本及 Node.js 测试；IDE 的 JAVA_MODULE 标签不代表它是 JVM 应用。
- 影响逻辑的代码修改后运行 npm test；涉及发布脚本生成时运行 npm run build 并检查生成差异。
- 测试可覆盖的行为优先通过现有 Node.js 测试复现。浏览器中的 DOM、油猴 API 和跨页面行为需要浏览器运行证据。

- 当前项目的调试技能位于 .agents/skills/ij-debugger/SKILL.md；使用前确认 IDE 的 JavaScript/Node.js 调试支持和配置，不能直接套用 JVM 专属能力。
