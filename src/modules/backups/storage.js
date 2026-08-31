const fs = require("fs/promises");
const path = require("path");

class LocalStorageProvider {
  constructor(rootPath) {
    this.name = "local";
    this.rootPath = path.resolve(rootPath || process.env.BACKUP_LOCAL_DIR || path.join(process.cwd(), "data", "backups"));
  }

  async upload(sourcePath, key) {
    await fs.mkdir(this.rootPath, { recursive: true });
    const targetPath = path.join(this.rootPath, key);
    await fs.copyFile(sourcePath, targetPath);
    return { key, location: targetPath, provider: this.name, metadata: await this.metadata(key) };
  }

  async download(key, targetPath) {
    await fs.copyFile(this.resolveKey(key), targetPath);
    return targetPath;
  }

  async delete(key) {
    await fs.rm(this.resolveKey(key), { force: true });
    return true;
  }

  async exists(key) {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch (_error) {
      return false;
    }
  }

  async metadata(key) {
    const stats = await fs.stat(this.resolveKey(key));
    return { sizeBytes: stats.size, updatedAt: stats.mtime.toISOString() };
  }

  resolveKey(keyOrLocation) {
    if (path.isAbsolute(String(keyOrLocation || ""))) {
      return keyOrLocation;
    }
    return path.join(this.rootPath, keyOrLocation);
  }
}

class UnsupportedCloudStorageProvider {
  constructor(name) {
    this.name = name;
  }

  unavailable() {
    const error = new Error(`${this.name} backup storage requires its provider SDK or a signed gateway configured outside this runtime.`);
    error.code = "BACKUP_STORAGE_NOT_CONFIGURED";
    return error;
  }

  async upload() { throw this.unavailable(); }
  async download() { throw this.unavailable(); }
  async delete() { throw this.unavailable(); }
  async exists() { throw this.unavailable(); }
  async metadata() { throw this.unavailable(); }
}

function createStorageProvider(destination = process.env.BACKUP_STORAGE_PROVIDER || "local") {
  const normalized = String(destination || "local").toLowerCase();
  if (["local", "filesystem", "disk"].includes(normalized)) {
    return new LocalStorageProvider();
  }
  if (["aws_s3", "s3", "cloudflare_r2", "r2", "gcs", "google_cloud_storage", "azure_blob", "s3_compatible"].includes(normalized)) {
    return new UnsupportedCloudStorageProvider(normalized);
  }
  return new LocalStorageProvider();
}

module.exports = { LocalStorageProvider, UnsupportedCloudStorageProvider, createStorageProvider };
