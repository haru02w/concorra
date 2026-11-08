import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FileStorage } from "@/modules/shared/ports";

export interface S3StorageOptions {
  bucket: string;
  endpoint?: string;
  /** Host used only in presigned URLs (e.g. the public reverse-proxy URL). */
  publicEndpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

type Sender = Pick<S3Client, "send">;

export class S3FileStorage implements FileStorage {
  private readonly client: Sender;
  private readonly presigner: S3Client;

  constructor(
    private readonly options: S3StorageOptions,
    clients: { client?: Sender; presigner?: S3Client } = {},
  ) {
    const base = {
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    };
    const internal = clients.client ?? new S3Client({ ...base, endpoint: options.endpoint });
    this.client = internal;
    this.presigner =
      clients.presigner ??
      (options.publicEndpoint || !(internal instanceof S3Client)
        ? new S3Client({ ...base, endpoint: options.publicEndpoint ?? options.endpoint })
        : internal);
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
    } catch (error) {
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name !== "NotFound" && e.name !== "NoSuchBucket" && e.$metadata?.httpStatusCode !== 404) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.options.bucket }));
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    return res.Body.transformToByteArray();
  }

  async presignGet(key: string, expiresInSeconds: number, downloadName?: string): Promise<string> {
    const disposition = downloadName
      ? `attachment; filename="${downloadName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
      : undefined;
    return getSignedUrl(
      this.presigner,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key, ResponseContentDisposition: disposition }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}
