import JSZip from "jszip";
import type { Archiver } from "@/modules/shared/ports";

export class JsZipArchiver implements Archiver {
  async zip(files: { name: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
    const zip = new JSZip();
    for (const file of files) zip.file(file.name, file.bytes);
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
}
