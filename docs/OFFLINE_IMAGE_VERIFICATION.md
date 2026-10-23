# 官方离线镜像身份核验

适用于 v0.1.0 及使用相同格式的历史 amd64 官方归档。仅处理从受信 GitHub Release 下载的归档及同名 JSON；先执行 `docker load -i lumi-linux-amd64.tar.gz`。版本和提交以本次下载的官方 JSON 为准，不将旧版本归档改名后冒充新版本。以下可选核验使用 Python 3.10+ 标准库，目标 Ubuntu 24.04 自带的 Python 3.12 已实测，不安装 pip 包，也不属于应用运行依赖。

发布 runner 的传统 Docker 存储将配置 digest 显示为 image ID；Docker 29 的 containerd 存储在导入 OCI 归档后可以显示归档 manifest digest。两者不同不直接代表镜像内容不同，也不能忽略差异。归档 manifest 使用未压缩层，因此也不必等于 GHCR 多架构 index 的 digest。

下面逐层建立联系：官方 JSON 的 `image_id` → 配置文件 SHA256 → `rootfs.diff_ids` → 每层内容 SHA256；再检查归档 manifest 的 SHA256 与配置引用，以及实际导入镜像的文件层和运行配置。所有断言必须通过，不改写官方 JSON 来迁就本机 ID。

```sh
python3 - <<'PY'
import hashlib
import json
import subprocess
import tarfile
from pathlib import Path

metadata = json.loads(Path('lumi-linux-amd64.json').read_text())
reference = metadata['image'] + ':' + metadata['version']
actual = json.loads(subprocess.check_output(['docker', 'image', 'inspect', reference]))[0]
with tarfile.open('lumi-linux-amd64.tar.gz') as archive:
    entry = json.load(archive.extractfile('manifest.json'))[0]
    assert entry['RepoTags'] == [reference]
    config_bytes = archive.extractfile(entry['Config']).read()
    config_digest = 'sha256:' + hashlib.sha256(config_bytes).hexdigest()
    assert config_digest == metadata['image_id']
    config = json.loads(config_bytes)
    assert actual['RootFS']['Layers'] == config['rootfs']['diff_ids']
    for layer, expected in zip(entry['Layers'], config['rootfs']['diff_ids'], strict=True):
        digest = hashlib.sha256()
        with archive.extractfile(layer) as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        assert 'sha256:' + digest.hexdigest() == expected
    descriptor = json.load(archive.extractfile('index.json'))['manifests'][0]
    archive_digest = descriptor['digest']
    manifest_bytes = archive.extractfile('blobs/sha256/' + archive_digest.split(':')[1]).read()
    assert 'sha256:' + hashlib.sha256(manifest_bytes).hexdigest() == archive_digest
    assert json.loads(manifest_bytes)['config']['digest'] == config_digest
    assert actual['Id'] in {config_digest, archive_digest}
    assert actual['Architecture'] == config['architecture'] == metadata['architecture']
    for field in ['User', 'Entrypoint', 'Cmd', 'Env', 'WorkingDir', 'Labels', 'ExposedPorts', 'Volumes', 'Healthcheck']:
        assert actual['Config'].get(field) == config['config'].get(field), field
    assert actual['Config']['User'] == '10001:10001'
print(json.dumps({'verified_config_digest': config_digest,
                  'archive_manifest_digest': archive_digest,
                  'docker_inspect_id': actual['Id'],
                  'published_manifest_digest': metadata['manifest_digest']}, indent=2))
PY
```

随后按部署手册启动完整栈，并核对 `/api/version` 的 `version` / `commit` 与官方 JSON。配置文件中的 OCI 标签不替代实际运行版本校验。任一核验失败时保留 Release 草稿并排查，不能跳过哈希或运行验证。
