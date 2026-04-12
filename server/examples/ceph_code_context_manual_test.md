# Ceph Code Context Manual Test

这个文档用于手动验证同页联动能力：

- 左侧选择节点并执行命令
- 从命令输出里提取函数候选
- 右侧基于固定 `repo / branch / commit` 渲染真实函数源码

## 固定代码上下文

- `repo`: `https://github.com/ceph/ceph.git`
- `branch`: `main`
- `commit`: `da84f9ce0f5244020a734407b5a33e3592387029`

## 页面入口

- 工具页：`源码上下文`
- 路由：`/code-context-explorer`

## 前置条件

- 服务端已启动
- 左侧至少有一个可执行命令的活动节点会话
- 右侧先完成一次代码上下文绑定

如果当前没有真实 Ceph 节点，也可以在任意 Linux 节点上直接执行本文里的 `printf` 命令。这个测试只依赖日志文本里的函数名，不依赖节点上真的安装 Ceph。

## 推荐测试步骤

1. 打开 `源码上下文`
2. 在页面顶部填写固定的 `repo / branch / commit`
3. 点击 `绑定代码版本`
4. 在左侧选择一个活动节点
5. 把下面的批量命令粘贴到命令输入框里执行
6. 从输出区里点击提取出的函数候选
7. 确认右侧渲染出的源码路径、函数名、上下文与预期一致
8. 使用鼠标滚轮继续向上向下展开上下文

## 批量命令

```bash
printf '%s\n' \
'2026-04-12T10:12:01.123+0800 7f11d2a7f700 -1 monclient: MonClient::handle_auth_bad_method old_auth_method=2 result=-13 allowed_methods=[2] allowed_modes=[1,2] auth failed for mon.a' \
'2026-04-12T10:12:01.124+0800 7f11d2a7f700  3 monclient: MonClient::handle_monmap accepted monmap epoch=945 previous_epoch=944' \
'2026-04-12T10:12:02.001+0800 7f11d2a7f700  5 objecter: Objecter::handle_osd_map got epochs [123,126] > 122 pool=rbd resend_ops=3' \
'2026-04-12T10:12:02.112+0800 7f11d2a7f700 10 objecter: Objecter::ms_dispatch2 type=CEPH_MSG_OSD_OPREPLY tid=9012 from osd.17' \
'2026-04-12T10:12:02.183+0800 7f11d2a7f700 20 objecter: Objecter::_send_op_account inflight_ops=128 target=osd.17 op=writefull oid=rbd_data.107' \
'2026-04-12T10:12:03.220+0800 7f11d2a7f700  5 pg: PG::get_with_id pgid=1.23 id=44 ref=7->8' \
'2026-04-12T10:12:03.221+0800 7f11d2a7f700  5 pg: PG::unlock pgid=1.23 state=active+clean releasing lock'
```

## 单条用例

| 函数 | 预期文件 | 预期行号 | 单条命令 |
| --- | --- | ---: | --- |
| `MonClient::handle_auth_bad_method` | `src/mon/MonClient.cc` | 1581 | `printf '%s\n' '2026-04-12T10:12:01.123+0800 7f11d2a7f700 -1 monclient: MonClient::handle_auth_bad_method old_auth_method=2 result=-13 allowed_methods=[2] allowed_modes=[1,2] auth failed for mon.a'` |
| `MonClient::handle_monmap` | `src/mon/MonClient.cc` | 407 | `printf '%s\n' '2026-04-12T10:12:01.124+0800 7f11d2a7f700  3 monclient: MonClient::handle_monmap accepted monmap epoch=945 previous_epoch=944'` |
| `Objecter::handle_osd_map` | `src/osdc/Objecter.cc` | 1210 | `printf '%s\n' '2026-04-12T10:12:02.001+0800 7f11d2a7f700  5 objecter: Objecter::handle_osd_map got epochs [123,126] > 122 pool=rbd resend_ops=3'` |
| `Objecter::ms_dispatch2` | `src/osdc/Objecter.cc` | 1024 | `printf '%s\n' '2026-04-12T10:12:02.112+0800 7f11d2a7f700 10 objecter: Objecter::ms_dispatch2 type=CEPH_MSG_OSD_OPREPLY tid=9012 from osd.17'` |
| `Objecter::_send_op_account` | `src/osdc/Objecter.cc` | 2411 | `printf '%s\n' '2026-04-12T10:12:02.183+0800 7f11d2a7f700 20 objecter: Objecter::_send_op_account inflight_ops=128 target=osd.17 op=writefull oid=rbd_data.107'` |
| `PG::get_with_id` | `src/osd/PG.cc` | 137 | `printf '%s\n' '2026-04-12T10:12:03.220+0800 7f11d2a7f700  5 pg: PG::get_with_id pgid=1.23 id=44 ref=7->8'` |
| `PG::unlock` | `src/osd/PG.cc` | 260 | `printf '%s\n' '2026-04-12T10:12:03.221+0800 7f11d2a7f700  5 pg: PG::unlock pgid=1.23 state=active+clean releasing lock'` |

## 通过标准

- 左侧命令执行后，函数候选列表能看到对应 `Class::method`
- 点击候选后，右侧搜索结果的第一命中与预期函数一致
- 右侧源码面板显示的文件路径与表格中的 `预期文件` 一致
- 右侧焦点函数范围覆盖表格中的 `预期行号`
- 继续滚轮滚动时，代码面板能增量展开上下文

## 样例文件

- 结构化样例 JSON: `server/examples/ceph_code_context_manual_cases.json`
