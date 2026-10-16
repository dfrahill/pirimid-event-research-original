import { get, put } from "@vercel/blob";
// One private workspace document. ETag compare-and-swap prevents concurrent lost writes.
export class CloudStore {
  constructor({
    read = get,
    write = put,
    path = "pirimid/workspace.json",
  } = {}) {
    this.get = read;
    this.put = write;
    this.path = path;
  }
  async read() {
    const result = await this.get(this.path, {
      access: "private",
      useCache: false,
    });
    if (!result) return { state: { jobs: [], shortlist: [] }, etag: null };
    if (result.statusCode !== 200) throw Error("Storage unavailable");
    return {
      state: JSON.parse(await new Response(result.stream).text()),
      etag: result.blob.etag,
    };
  }
  async mutate(fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { state, etag } = await this.read();
      const result = fn(state);
      try {
        await this.put(this.path, JSON.stringify(state), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: !!etag,
          ...(etag ? { ifMatch: etag } : {}),
          contentType: "application/json",
          cacheControlMaxAge: 60,
        });
        return result;
      } catch (e) {
        if (
          !["BlobPreconditionFailedError", "BlobAlreadyExistsError"].includes(
            e.name,
          )
        )
          throw e;
      }
    }
    throw Error("Workspace busy. Retry.");
  }
}
