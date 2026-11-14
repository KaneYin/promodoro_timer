# Project working conventions / 项目工作约定

- Base feature branches and pull requests on `reference/complete-implementation`; `main` is the learning scaffold.
- When changing user-visible behavior, update `README.md` and `README.zh-CN.md` in the same change. Keep feature descriptions, English UI labels, usage steps and setup instructions consistent with the implementation.
- For visible UI changes, refresh the relevant screenshots under `docs/images/` and their captions/alt text in both READMEs. Capture the actual app; clearly label example data and exclude credentials, private URLs and unrelated browser content.
- Keep `llms.txt` consistent when its feature summary or documentation links change. Run checks appropriate to the change; for documentation, verify local links, image paths and the rendered layout.

每次调整用户可见功能，都要在同一次修改中同步更新中英文 README；界面变化时更新对应的真实截图和操作说明，示例数据须标明。功能分支及 PR 以 `reference/complete-implementation` 为目标，`main` 保留为练习脚手架。
