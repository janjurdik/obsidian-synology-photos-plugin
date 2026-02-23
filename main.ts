import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  MarkdownPostProcessorContext,
  requestUrl,
} from "obsidian";

interface SynologyPhotosSettings {
  synologyUrl: string;
  username: string;
  password: string;
  useHttps: boolean;
  port: number;
  personalSpaceIdOffset: number;
  sharedSpaceIdOffset: number;
}

const DEFAULT_SETTINGS: SynologyPhotosSettings = {
  synologyUrl: "",
  username: "",
  password: "",
  useHttps: true,
  port: 5001,
  personalSpaceIdOffset: 0,
  sharedSpaceIdOffset: 0,
};

export default class SynologyPhotosPlugin extends Plugin {
  settings: SynologyPhotosSettings;
  private sessionId: string | null = null;

  async onload() {
    await this.loadSettings();

    this.registerMarkdownCodeBlockProcessor(
      "synology-photos",
      this.processSynologyPhotosBlock.bind(this),
    );
    this.registerMarkdownCodeBlockProcessor(
      "synology-person-avatar",
      this.processSynologyPersonAvatarBlock.bind(this),
    );

    this.registerMarkdownPostProcessor((el, ctx) => {
      const codeElements = el.querySelectorAll("code");
      codeElements.forEach(async (codeEl) => {
        const text = codeEl.textContent || "";

        if (text.startsWith("synology-avatar:")) {
          const personName = JSON.parse(
            JSON.stringify(text.substring("synology-avatar:".length).trim()),
          );
          codeEl.setText("");
          if (personName) {
            let avatarUrl = await this.getPersonAvatar(personName, "personal");
            if (!avatarUrl)
              avatarUrl = await this.getPersonAvatar(personName, "shared");
            if (avatarUrl) {
              const img = createEl("img", {
                cls: "synology-person-avatar",
                attr: {
                  src: avatarUrl,
                  alt: personName,
                  title: personName,
                  style:
                    "width: 40px; height: 40px; border-radius: 50%; object-fit: cover; vertical-align: middle;",
                },
              });
              codeEl.replaceWith(img);
            }
          }
        }
      });
    });

    this.addSettingTab(new SynologyPhotosSettingTab(this.app, this));

    this.addCommand({
      id: "synology-photos-login",
      name: "Login to Synology Photos",
      callback: async () => {
        try {
          await this.login();
          new Notice("Successfully logged in to Synology Photos");
        } catch (error) {
          new Notice(`Login error: ${error.message}`);
        }
      },
    });

    console.log("Synology Photos Integration plugin loaded");
  }

  onunload() {
    console.log("Synology Photos Integration plugin unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private getBaseUrl(): string {
    const protocol = this.settings.useHttps ? "https" : "http";
    const portPart = this.settings.port !== -1 ? `:${this.settings.port}` : "";
    return `${protocol}://${this.settings.synologyUrl}${portPart}`;
  }

  private async login(): Promise<string> {
    if (
      !this.settings.synologyUrl ||
      !this.settings.username ||
      !this.settings.password
    ) {
      throw new Error(
        "Please set Synology URL, username and password in plugin settings",
      );
    }

    const url = `${this.getBaseUrl()}/webapi/auth.cgi`;
    const params = new URLSearchParams({
      api: "SYNO.API.Auth",
      version: "3",
      method: "login",
      account: this.settings.username,
      passwd: this.settings.password,
    });

    const fullUrl = `${url}?${params.toString()}`;

    try {
      const response = await requestUrl({ url: fullUrl, method: "GET" });

      const data = response.json;

      if (data.success && data.data.sid) {
        this.sessionId = data.data.sid;
        return this.sessionId || "";
      } else {
        throw new Error(`Login failed: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      console.error("[Synology Photos] Login error:", {
        error: error,
        message: error.message,
        url: fullUrl,
      });
      throw error;
    }
  }

  private async ensureLoggedIn(): Promise<string> {
    if (!this.sessionId) {
      return await this.login();
    }
    return this.sessionId;
  }

  private async fetchPhotosByPerson(
    personName: string,
    space: "personal" | "shared" = "personal",
    offset: number = 0,
    limit: number = 1000,
  ): Promise<any[]> {
    const sid = await this.ensureLoggedIn();
    const baseUrl = this.getBaseUrl();

    const apiPrefix = space === "shared" ? "SYNO.FotoTeam" : "SYNO.Foto";

    const personListUrl = `${baseUrl}/webapi/entry.cgi`;
    const personParams = new URLSearchParams({
      api: `${apiPrefix}.Browse.Person`,
      version: "1",
      method: "list",
      offset: "0",
      limit: "1000",
      _sid: sid,
    });

    try {
      const personListFullUrl = `${personListUrl}?${personParams.toString()}`;

      const personResponse = await requestUrl({
        url: personListFullUrl,
        method: "GET",
      });

      const personData = personResponse.json;

      if (!personData.success) {
        throw new Error(`Failed to load people: ${JSON.stringify(personData)}`);
      }

      const availablePersons =
        personData.data?.list?.map((p: any) => p.name) || [];

      const targetPerson = personData.data?.list?.find(
        (p: any) => p.name.toLowerCase() === personName.toLowerCase(),
      );

      if (!targetPerson) {
        throw new Error(
          `Person "${personName}" not found. Available persons: ${availablePersons.join(", ")}`,
        );
      }

      const photosUrl = `${baseUrl}/webapi/entry.cgi`;
      const photosParams = new URLSearchParams({
        api: `${apiPrefix}.Browse.Item`,
        version: "1",
        method: "list",
        person_id: targetPerson.id.toString(),
        additional: JSON.stringify(["thumbnail", "resolution"]),
        offset: offset.toString(),
        limit: limit.toString(),
        _sid: sid,
      });

      const photosFullUrl = `${photosUrl}?${photosParams.toString()}`;

      const photosResponse = await requestUrl({
        url: photosFullUrl,
        method: "GET",
      });

      const photosData = photosResponse.json;

      if (!photosData.success) {
        throw new Error(`Failed to load photos: ${JSON.stringify(photosData)}`);
      }
      const photosList = photosData.data?.list || [];
      return photosList;
    } catch (error) {
      console.error("[Synology Photos] Error fetching photos:", {
        error: error,
        message: error.message,
        person: personName,
        baseUrl: baseUrl,
      });
      throw error;
    }
  }

  private async getPersonAvatar(
    personName: string,
    space: "personal" | "shared" = "personal",
  ): Promise<string> {
    const cachedPath = `Images/People/${personName}.jpg`;
    const cachedFile = this.app.vault.getAbstractFileByPath(cachedPath);

    if (cachedFile) {
      return this.app.vault.getResourcePath(cachedFile as any);
    }

    const sid = await this.ensureLoggedIn();
    const baseUrl = this.getBaseUrl();

    const apiPrefix = space === "shared" ? "SYNO.FotoTeam" : "SYNO.Foto";

    const personListUrl = `${baseUrl}/webapi/entry.cgi`;
    const personParams = new URLSearchParams({
      api: `${apiPrefix}.Browse.Person`,
      version: "1",
      method: "list",
      offset: "0",
      limit: "1000",
      additional: JSON.stringify(["thumbnail"]),
      _sid: sid,
    });

    try {
      const personListFullUrl = `${personListUrl}?${personParams.toString()}`;
      const personResponse = await requestUrl({
        url: personListFullUrl,
        method: "GET",
      });
      const personData = personResponse.json;

      if (!personData.success) {
        return "";
      }

      const targetPerson = personData.data?.list?.find(
        (p: any) => p.name.toLowerCase() === personName.toLowerCase(),
      );

      if (!targetPerson || !targetPerson.additional?.thumbnail?.cache_key) {
        return "";
      }

      const cacheKey = targetPerson.additional.thumbnail.cache_key;
      const personId = targetPerson.id;
      const apiName =
        space === "shared" ? "SYNO.FotoTeam.Thumbnail" : "SYNO.Foto.Thumbnail";

      const avatarUrl = `${baseUrl}/webapi/entry.cgi?api=${apiName}&version=1&method=get&mode=download&id=${personId}&type=person&cache_key=${cacheKey}&_sid=${this.sessionId}`;

      try {
        const imageResponse = await requestUrl({
          url: avatarUrl,
          method: "GET",
        });
        const imageData = imageResponse.arrayBuffer;

        await this.app.vault.createFolder("Images/People").catch(() => {});

        const file = await this.app.vault.createBinary(cachedPath, imageData);
        return this.app.vault.getResourcePath(file);
      } catch (saveError) {
        console.error("[Synology Photos] Error saving avatar:", saveError);
        return avatarUrl;
      }
    } catch (error) {
      console.error("[Synology Photos] Error fetching person avatar:", error);
      return "";
    }
  }

  private async fetchPhotosByAlbum(
    album: string,
    space: "personal" | "shared" = "personal",
    offset: number = 0,
    limit: number = 1000,
  ): Promise<any[]> {
    const sid = await this.ensureLoggedIn();
    const baseUrl = this.getBaseUrl();

    // Pre albumy vždy používame personal API na načítanie zoznamu
    const apiPrefix = "SYNO.Foto";

    const albumListUrl = `${baseUrl}/webapi/entry.cgi`;
    const albumParams = new URLSearchParams({
      api: `${apiPrefix}.Browse.Album`,
      version: "1",
      method: "list",
      offset: "0",
      limit: "1000",
      _sid: sid,
    });

    try {
      const albumListFullUrl = `${albumListUrl}?${albumParams.toString()}`;

      const albumResponse = await requestUrl({
        url: albumListFullUrl,
        method: "GET",
      });

      const albumData = albumResponse.json;

      if (!albumData.success) {
        throw new Error(`Failed to load albums: ${JSON.stringify(albumData)}`);
      }

      const availableAlbums =
        albumData.data?.list?.map((a: any) => a.name) || [];

      const targetAlbum = albumData.data?.list?.find(
        (a: any) => a.name.toLowerCase() === album.toLowerCase(),
      );

      if (!targetAlbum) {
        throw new Error(
          `Album "${album}" not found. Available albums: ${availableAlbums.join(", ")}`,
        );
      }

      const photosUrl = `${baseUrl}/webapi/entry.cgi`;
      const photosParams = new URLSearchParams({
        api: `${apiPrefix}.Browse.Item`,
        version: "1",
        method: "list",
        album_id: targetAlbum.id.toString(),
        additional: JSON.stringify(["thumbnail", "resolution"]),
        offset: offset.toString(),
        limit: limit.toString(),
        _sid: sid,
      });

      const photosFullUrl = `${photosUrl}?${photosParams.toString()}`;

      const photosResponse = await requestUrl({
        url: photosFullUrl,
        method: "GET",
      });

      const photosData = photosResponse.json;

      if (!photosData.success) {
        throw new Error(`Failed to load photos: ${JSON.stringify(photosData)}`);
      }
      const photosList = photosData.data?.list || [];
      return photosList;
    } catch (error) {
      console.error("[Synology Photos] Error fetching photos:", {
        error: error,
        message: error.message,
        album: album,
        baseUrl: baseUrl,
      });
      throw error;
    }
  }

  private async fetchPhotosByTag(
    tag: string,
    space: "personal" | "shared" = "personal",
    offset: number = 0,
    limit: number = 1000,
  ): Promise<any[]> {
    const sid = await this.ensureLoggedIn();
    const baseUrl = this.getBaseUrl();

    const apiPrefix = space === "shared" ? "SYNO.FotoTeam" : "SYNO.Foto";

    const tagListUrl = `${baseUrl}/webapi/entry.cgi`;
    const tagParams = new URLSearchParams({
      api: `${apiPrefix}.Browse.GeneralTag`,
      version: "1",
      method: "list",
      offset: "0",
      limit: "1000",
      _sid: sid,
    });

    try {
      const tagListFullUrl = `${tagListUrl}?${tagParams.toString()}`;

      const tagResponse = await requestUrl({
        url: tagListFullUrl,
        method: "GET",
      });

      const tagData = tagResponse.json;

      if (!tagData.success) {
        throw new Error(`Failed to load tags: ${JSON.stringify(tagData)}`);
      }

      const availableTags = tagData.data?.list?.map((t: any) => t.name) || [];

      const targetTag = tagData.data?.list?.find(
        (t: any) => t.name.toLowerCase() === tag.toLowerCase(),
      );

      if (!targetTag) {
        throw new Error(
          `Tag "${tag}" not found. Available tags: ${availableTags.join(", ")}`,
        );
      }

      const photosUrl = `${baseUrl}/webapi/entry.cgi`;
      const photosParams = new URLSearchParams({
        api: `${apiPrefix}.Browse.Item`,
        version: "1",
        method: "list",
        general_tag_id: targetTag.id.toString(),
        additional: JSON.stringify(["thumbnail", "resolution"]),
        offset: offset.toString(),
        limit: limit.toString(),
        _sid: sid,
      });

      const photosFullUrl = `${photosUrl}?${photosParams.toString()}`;

      const photosResponse = await requestUrl({
        url: photosFullUrl,
        method: "GET",
      });

      const photosData = photosResponse.json;

      if (!photosData.success) {
        throw new Error(`Failed to load photos: ${JSON.stringify(photosData)}`);
      }
      const photosList = photosData.data?.list || [];
      return photosList;
    } catch (error) {
      console.error("[Synology Photos] Error fetching photos:", {
        error: error,
        message: error.message,
        tag: tag,
        baseUrl: baseUrl,
      });
      throw error;
    }
  }

  private async fetchRecentPhotos(
    space: "personal" | "shared" = "personal",
    offset: number = 0,
    limit: number = 1000,
  ): Promise<any[]> {
    const sid = await this.ensureLoggedIn();
    const baseUrl = this.getBaseUrl();

    const apiPrefix = space === "shared" ? "SYNO.FotoTeam" : "SYNO.Foto";

    const photosUrl = `${baseUrl}/webapi/entry.cgi`;
    const photosParams = new URLSearchParams({
      api: `${apiPrefix}.Browse.Item`,
      version: "1",
      method: "list",
      additional: JSON.stringify(["thumbnail", "resolution"]),
      offset: offset.toString(),
      limit: limit.toString(),
      _sid: sid,
    });

    try {
      const photosFullUrl = `${photosUrl}?${photosParams.toString()}`;

      const photosResponse = await requestUrl({
        url: photosFullUrl,
        method: "GET",
      });

      const photosData = photosResponse.json;

      if (!photosData.success) {
        throw new Error(`Failed to load photos: ${JSON.stringify(photosData)}`);
      }

      const photosList = photosData.data?.list || [];
      return photosList;
    } catch (error) {
      console.error("[Synology Photos] Error fetching photos:", {
        error: error,
        message: error.message,
        baseUrl: baseUrl,
      });
      throw error;
    }
  }

  private async fetchPhotosByLocation(
    location: string,
    space: "personal" | "shared" = "personal",
    offset: number = 0,
    limit: number = 1000,
  ): Promise<any[]> {
    const sid = await this.ensureLoggedIn();
    const baseUrl = this.getBaseUrl();

    const apiPrefix = space === "shared" ? "SYNO.FotoTeam" : "SYNO.Foto";

    try {
      const photosUrl = `${baseUrl}/webapi/entry.cgi`;
      const photosParams = new URLSearchParams({
        api: `${apiPrefix}.Search.Search`,
        version: "1",
        method: "list_item",
        keyword: location,
        additional: JSON.stringify(["thumbnail", "resolution"]),
        offset: offset.toString(),
        limit: limit.toString(),
        _sid: sid,
      });

      const photosFullUrl = `${photosUrl}?${photosParams.toString()}`;

      const photosResponse = await requestUrl({
        url: photosFullUrl,
        method: "GET",
      });

      const photosData = photosResponse.json;

      if (!photosData.success) {
        throw new Error(
          `Failed to search photos: ${JSON.stringify(photosData)}`,
        );
      }

      const photosList = photosData.data?.list || [];
      return photosList;
    } catch (error) {
      console.error("[Synology Photos] Error fetching photos:", {
        error: error,
        message: error.message,
        location: location,
        baseUrl: baseUrl,
      });
      throw error;
    }
  }

  private async fetchPhotosByDay(
    day: string,
    space: "personal" | "shared" = "personal",
    offset: number = 0,
    limit: number = 1000,
  ): Promise<any[]> {
    const sid = await this.ensureLoggedIn();
    const baseUrl = this.getBaseUrl();

    const apiPrefix = space === "shared" ? "SYNO.FotoTeam" : "SYNO.Foto";

    try {
      // Parse the date and convert to Unix timestamps (in seconds)
      const date = new Date(day);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${day}. Use YYYY-MM-DD format.`);
      }

      // Start of day (00:00:00)
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const startTime = Math.floor(startOfDay.getTime() / 1000);

      // End of day (23:59:59)
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      const endTime = Math.floor(endOfDay.getTime() / 1000);

      const photosUrl = `${baseUrl}/webapi/entry.cgi`;
      const photosParams = new URLSearchParams({
        api: `${apiPrefix}.Browse.Item`,
        version: "1",
        method: "list",
        start_time: startTime.toString(),
        end_time: endTime.toString(),
        additional: JSON.stringify(["thumbnail", "resolution"]),
        offset: offset.toString(),
        limit: limit.toString(),
        _sid: sid,
      });

      const photosFullUrl = `${photosUrl}?${photosParams.toString()}`;

      const photosResponse = await requestUrl({
        url: photosFullUrl,
        method: "GET",
      });

      const photosData = photosResponse.json;

      if (!photosData.success) {
        throw new Error(
          `Failed to load photos for day: ${JSON.stringify(photosData)}`,
        );
      }

      const photosList = photosData.data?.list || [];
      return photosList;
    } catch (error) {
      console.error("[Synology Photos] Error fetching photos by day:", {
        error: error,
        message: error.message,
        day: day,
        baseUrl: baseUrl,
      });
      throw error;
    }
  }

  private findCorrectPhotoId(photo: any): number {
    const originalId = parseInt(photo.id);
    const cacheKey = photo.additional?.thumbnail?.cache_key;

    if (!cacheKey) {
      return originalId;
    }

    // Cache key format: "thumbnailID_timestamp"
    const cacheKeyParts = cacheKey.split("_");
    if (cacheKeyParts.length >= 2) {
      const correctThumbnailId = parseInt(cacheKeyParts[0]);

      if (!isNaN(correctThumbnailId)) {
        const offset = correctThumbnailId - originalId;

        if (offset !== 0) {
          console.log(
            `[Photo ID Mismatch] Item ID: ${originalId}, Correct Thumbnail ID: ${correctThumbnailId}, Offset: ${offset}`,
          );
        }

        return correctThumbnailId;
      }
    }

    return originalId;
  }

  private getThumbnailUrl(
    photo: any,
    size: "sm" | "m" | "xl" = "xl",
    space: "personal" | "shared" = "personal",
    customPhotoId?: number,
  ): string {
    const baseUrl = this.getBaseUrl();
    const { additional } = photo;
    const cacheKey = additional?.thumbnail?.cache_key;

    if (!cacheKey) {
      return "";
    }

    const photoId =
      customPhotoId !== undefined ? customPhotoId : parseInt(photo.id);
    const apiName =
      space === "shared" ? "SYNO.FotoTeam.Thumbnail" : "SYNO.Foto.Thumbnail";

    return `${baseUrl}/webapi/entry.cgi?api=${apiName}&version=1&method=get&mode=download&id=${photoId}&type=unit&size=${size}&cache_key=${cacheKey}&_sid=${this.sessionId}`;
  }

  private async processSynologyPhotosBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ) {
    const lines = source.trim().split("\n");
    let tag = "";
    let person = "";
    let location = "";
    let day = "";
    let album = "";
    let space: "personal" | "shared" = "personal";
    let columns = 3;
    let size: "sm" | "m" | "xl" = "xl";
    let limit = 0;

    for (const line of lines) {
      const [key, value] = line.split(":").map((s) => s.trim());
      if (key === "tag") tag = value;
      if (key === "person") person = value;
      if (key === "location") location = value;
      if (key === "day") day = value;
      if (key === "album") album = value;
      if (key === "space" && ["personal", "shared"].includes(value))
        space = value as "personal" | "shared";
      if (key === "columns") columns = parseInt(value) || 3;
      if (key === "limit") limit = parseInt(value) || 0;
      if (key === "size" && ["sm", "m", "xl"].includes(value))
        size = value as "sm" | "m" | "xl";
    }

    const container = el.createEl("div", { cls: "synology-photos-container" });

    // Controls container
    const controls = container.createEl("div", {
      cls: "synology-photos-controls",
    });
    controls.style.display = "flex";
    controls.style.gap = "10px";
    controls.style.marginBottom = "10px";

    // Space toggle button
    let currentSpace = space;
    const spaceBtn = controls.createEl("button", {
      text: `Space: ${currentSpace}`,
      cls: "synology-photos-toggle-btn",
    });

    const loading = container.createEl("div", {
      text: "Loading photos...",
      cls: "synology-photos-loading",
    });

    let currentOffset = 0;
    const fetchLimit = limit > 0 ? limit : 50;
    let grid: HTMLElement | null = null;
    let loadMoreBtn: HTMLButtonElement | null = null;

    const renderPhotos = (photos: any[]) => {
      if (!grid) return;

      for (const photo of photos) {
        const photoContainer = grid.createEl("div", {
          cls: "synology-photo-item",
        });
        const img = photoContainer.createEl("img", {
          cls: "synology-photo-img",
        });

        const correctId = photo._correctedId || this.findCorrectPhotoId(photo);
        photo._correctedId = correctId;

        img.src = this.getThumbnailUrl(photo, size, currentSpace, correctId);
        img.alt = photo.filename || "Synology Photo";
        img.title = photo.filename || "";

        photoContainer.addEventListener("click", () => {
          this.openPhotoModal(photo, currentSpace);
        });
      }
    };

    const loadPhotos = async (reset: boolean = false) => {
      try {
        if (reset) {
          currentOffset = 0;
          if (grid) {
            grid.remove();
            grid = null;
          }
          if (loadMoreBtn) {
            loadMoreBtn.remove();
            loadMoreBtn = null;
          }
        }

        if (loadMoreBtn) {
          loadMoreBtn.setText("Loading...");
          loadMoreBtn.disabled = true;
        }

        const photos = tag
          ? await this.fetchPhotosByTag(
              tag,
              currentSpace,
              currentOffset,
              fetchLimit,
            )
          : person
            ? await this.fetchPhotosByPerson(
                person,
                currentSpace,
                currentOffset,
                fetchLimit,
              )
            : location
              ? await this.fetchPhotosByLocation(
                  location,
                  currentSpace,
                  currentOffset,
                  fetchLimit,
                )
              : day
                ? await this.fetchPhotosByDay(
                    day,
                    currentSpace,
                    currentOffset,
                    fetchLimit,
                  )
                : album
                  ? await this.fetchPhotosByAlbum(
                      album,
                      currentSpace,
                      currentOffset,
                      fetchLimit,
                    )
                  : await this.fetchRecentPhotos(
                      currentSpace,
                      currentOffset,
                      fetchLimit,
                    );
        // Silent on no photos found

        if (currentOffset === 0) {
          loading.remove();
          grid = container.createEl("div", { cls: "synology-photos-grid" });
          grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
        }

        // Render photos directly
        renderPhotos(photos);

        currentOffset += photos.length;

        if (!loadMoreBtn) {
          loadMoreBtn = container.createEl("button", {
            text: "Load more",
            cls: "synology-photos-load-more",
          });
          loadMoreBtn.addEventListener("click", () => loadPhotos(false));
        } else {
          loadMoreBtn.setText("Load more");
          loadMoreBtn.disabled = false;
        }
        if (photos.length < fetchLimit) {
          loadMoreBtn.style.display = "none";
        } else {
          loadMoreBtn.style.display = "block";
        }
      } catch (error) {
        // Silent on error - no error message
        if (currentOffset === 0) {
          loading.remove();
        } else {
          if (loadMoreBtn) {
            loadMoreBtn.style.display = "none";
          }
        }
      }
    };

    // Space toggle handler
    spaceBtn.addEventListener("click", async () => {
      currentSpace = currentSpace === "personal" ? "shared" : "personal";
      spaceBtn.setText(`Space: ${currentSpace}`);
      await loadPhotos(true);
    });

    loadPhotos();
  }

  private async processSynologyPersonAvatarBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ) {
    const lines = source.trim().split("\n");
    let person = "";
    let space: "personal" | "shared" = "personal";
    let size = "50px";

    for (const line of lines) {
      const [key, value] = line.split(":").map((s) => s.trim());
      if (key === "person") person = value;
      if (key === "space" && ["personal", "shared"].includes(value))
        space = value as "personal" | "shared";
      if (key === "size") size = value;
    }

    if (!person) {
      // Silent - no icon for missing person
      return;
    }

    try {
      const avatarUrl = await this.getPersonAvatar(person, space);

      if (avatarUrl) {
        const img = el.createEl("img", {
          cls: "synology-person-avatar",
          attr: {
            src: avatarUrl,
            alt: person,
            title: person,
            style: `width: ${size}; height: ${size}; border-radius: 50%; object-fit: cover;`,
          },
        });
      }
    } catch (error) {
      // Silent on error - no icon displayed
    }
  }

  private openPhotoModal(
    photo: any,
    space: "personal" | "shared" = "personal",
  ) {
    const modal = document.createElement("div");
    modal.addClass("synology-photo-modal");

    const modalContent = modal.createEl("div", {
      cls: "synology-photo-modal-content",
    });
    const img = modalContent.createEl("img");

    const correctId = photo._correctedId || this.findCorrectPhotoId(photo);
    const thumbnailUrl = this.getThumbnailUrl(photo, "xl", space, correctId);
    img.src = thumbnailUrl;
    img.alt = photo.filename;

    const urlContainer = modalContent.createEl("div", {
      cls: "synology-photo-url",
    });
    urlContainer.createEl("div", {
      text: photo.filename || "Unknown",
      cls: "synology-photo-filename",
    });
    const urlText = urlContainer.createEl("input", {
      cls: "synology-photo-url-input",
      attr: {
        type: "text",
        value: thumbnailUrl,
        readonly: "readonly",
      },
    });

    urlText.addEventListener("click", (e) => {
      e.stopPropagation();
      urlText.select();
    });

    modal.addEventListener("click", () => {
      modal.remove();
    });

    document.body.appendChild(modal);
  }
}

class SynologyPhotosSettingTab extends PluginSettingTab {
  plugin: SynologyPhotosPlugin;

  constructor(app: App, plugin: SynologyPhotosPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", {
      text: "Synology Photos Integration - Settings",
    });

    new Setting(containerEl)
      .setName("Synology URL")
      .setDesc(
        "IP address or hostname of your Synology NAS (without protocol and port)",
      )
      .addText((text) =>
        text
          .setPlaceholder("192.168.1.100")
          .setValue(this.plugin.settings.synologyUrl)
          .onChange(async (value) => {
            this.plugin.settings.synologyUrl = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Use HTTPS")
      .setDesc("Enable HTTPS protocol")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useHttps)
          .onChange(async (value) => {
            this.plugin.settings.useHttps = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Port")
      .setDesc(
        "Port for Synology Photos (default: 5001 for HTTPS, 5000 for HTTP)",
      )
      .addText((text) =>
        text
          .setPlaceholder("5001")
          .setValue(this.plugin.settings.port.toString())
          .onChange(async (value) => {
            const port = parseInt(value);
            if (!isNaN(port)) {
              this.plugin.settings.port = port;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Username")
      .setDesc("Username for Synology")
      .addText((text) =>
        text
          .setPlaceholder("admin")
          .setValue(this.plugin.settings.username)
          .onChange(async (value) => {
            this.plugin.settings.username = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Password")
      .setDesc("Password for Synology")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("••••••••")
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Test connection to Synology Photos")
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          try {
            await this.plugin["login"]();
            new Notice("✓ Connection successful!");
          } catch (error) {
            new Notice(`✗ Connection error: ${error.message}`);
          }
        }),
      );

    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl)
      .setName("Personal Space ID Offset")
      .setDesc(
        "Offset for photo IDs in personal space (use if thumbnails show wrong images after import)",
      )
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(this.plugin.settings.personalSpaceIdOffset.toString())
          .onChange(async (value) => {
            const offset = parseInt(value);
            if (!isNaN(offset)) {
              this.plugin.settings.personalSpaceIdOffset = offset;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Shared Space ID Offset")
      .setDesc(
        "Offset for photo IDs in shared space (use if thumbnails show wrong images after import)",
      )
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(this.plugin.settings.sharedSpaceIdOffset.toString())
          .onChange(async (value) => {
            const offset = parseInt(value);
            if (!isNaN(offset)) {
              this.plugin.settings.sharedSpaceIdOffset = offset;
              await this.plugin.saveSettings();
            }
          }),
      );

    containerEl.createEl("h3", { text: "Usage" });
    const usage = containerEl.createEl("div", { cls: "synology-photos-usage" });
    usage.createEl("p", {
      text: 'Create a code block with type "synology-photos" in your note and set parameters:',
    });

    const codeExample = usage.createEl("pre");
    codeExample.createEl("code", {
      text: `\`\`\`synology-photos
tag: travel
space: personal
columns: 3
size: xl
limit: 20
\`\`\`

or

\`\`\`synology-photos
person: John Doe
space: shared
columns: 3
size: xl
\`\`\`

or

\`\`\`synology-photos
album: Vacation 2026
space: personal
columns: 3
size: xl
\`\`\`

or

\`\`\`synology-photos
day: 2026-01-31
space: personal
columns: 3
size: xl
\`\`\``,
    });

    usage.createEl("p", { text: "Parameters:" });
    const params = usage.createEl("ul");
    params.createEl("li", {
      text: "tag: tag name in Synology Photos (use either tag, person, album, location, or day)",
    });
    params.createEl("li", {
      text: "person: person name in Synology Photos (use either tag, person, album, location, or day)",
    });
    params.createEl("li", {
      text: "album: album name in Synology Photos (use either tag, person, album, location, or day)",
    });
    params.createEl("li", {
      text: "location: location keyword to search for (use either tag, person, album, location, or day)",
    });
    params.createEl("li", {
      text: "day: date in YYYY-MM-DD format to show photos from that day (use either tag, person, album, location, or day)",
    });
    params.createEl("li", {
      text: "space: personal or shared (default: personal)",
    });
    params.createEl("li", {
      text: "columns: number of columns in grid (default: 3)",
    });
    params.createEl("li", {
      text: "limit: maximum number of photos to display (default: all)",
    });
    params.createEl("li", {
      text: "size: thumbnail size - sm, m, xl (default: xl)",
    });
  }
}
