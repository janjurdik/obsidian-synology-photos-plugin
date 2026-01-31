import { App, Plugin, PluginSettingTab, Setting, Notice, MarkdownPostProcessorContext, requestUrl } from 'obsidian';

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
	synologyUrl: '',
	username: '',
	password: '',
	useHttps: true,
	port: 5001,
	personalSpaceIdOffset: 0,
	sharedSpaceIdOffset: 0
}

export default class SynologyPhotosPlugin extends Plugin {
	settings: SynologyPhotosSettings;
	private sessionId: string | null = null;

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor('synology-photos', this.processSynologyPhotosBlock.bind(this));
		this.addSettingTab(new SynologyPhotosSettingTab(this.app, this));

		this.addCommand({
			id: 'synology-photos-login',
			name: 'Login to Synology Photos',
			callback: async () => {
				try {
					await this.login();
					new Notice('Successfully logged in to Synology Photos');
				} catch (error) {
					new Notice(`Login error: ${error.message}`);
				}
			}
		});

		console.log('Synology Photos Integration plugin loaded');
	}

	onunload() {
		console.log('Synology Photos Integration plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private getBaseUrl(): string {
		const protocol = this.settings.useHttps ? 'https' : 'http';
		const portPart = this.settings.port !== -1 ? `:${this.settings.port}` : '';
		return `${protocol}://${this.settings.synologyUrl}${portPart}`;
	}

	private async login(): Promise<string> {
		if (!this.settings.synologyUrl || !this.settings.username || !this.settings.password) {
			throw new Error('Please set Synology URL, username and password in plugin settings');
		}

		const url = `${this.getBaseUrl()}/webapi/auth.cgi`;
		const params = new URLSearchParams({
			api: 'SYNO.API.Auth',
			version: '3',
			method: 'login',
			account: this.settings.username,
			passwd: this.settings.password
		});

		const fullUrl = `${url}?${params.toString()}`;

		try {
			const response = await requestUrl({ url: fullUrl, method: 'GET' });
			
			const data = response.json;

			if (data.success && data.data.sid) {
				this.sessionId = data.data.sid;
				return this.sessionId || "";
			} else {
				throw new Error(`Login failed: ${JSON.stringify(data)}`);
			}
		} catch (error) {
			console.error('[Synology Photos] Login error:', {
				error: error,
				message: error.message,
				url: fullUrl
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

	private async fetchPhotosByPerson(personName: string, space: 'personal' | 'shared' = 'personal', offset: number = 0, limit: number = 1000): Promise<any[]> {
		const sid = await this.ensureLoggedIn();
		const baseUrl = this.getBaseUrl();

		const apiPrefix = space === 'shared' ? 'SYNO.FotoTeam' : 'SYNO.Foto';

		const personListUrl = `${baseUrl}/webapi/entry.cgi`;
		const personParams = new URLSearchParams({
			api: `${apiPrefix}.Browse.Person`,
			version: '1',
			method: 'list',
			offset: '0',
			limit: '1000',
			_sid: sid
		});

		try {
			const personListFullUrl = `${personListUrl}?${personParams.toString()}`;
			
			const personResponse = await requestUrl({ url: personListFullUrl, method: 'GET' });
			
			const personData = personResponse.json;

			if (!personData.success) {
				throw new Error(`Failed to load people: ${JSON.stringify(personData)}`);
			}

			const availablePersons = personData.data?.list?.map((p: any) => p.name) || [];
			
			const targetPerson = personData.data?.list?.find((p: any) => 
				p.name.toLowerCase() === personName.toLowerCase()
			);

			if (!targetPerson) {
				throw new Error(`Person "${personName}" not found. Available persons: ${availablePersons.join(', ')}`);
			}

			const photosUrl = `${baseUrl}/webapi/entry.cgi`;
			const photosParams = new URLSearchParams({
				api: `${apiPrefix}.Browse.Item`,
				version: '1',
				method: 'list',
				person_id: targetPerson.id.toString(),
				additional: JSON.stringify(['thumbnail', 'resolution']),
				offset: offset.toString(),
				limit: limit.toString(),
				_sid: sid
			});

			const photosFullUrl = `${photosUrl}?${photosParams.toString()}`;
			
			const photosResponse = await requestUrl({ url: photosFullUrl, method: 'GET' });
			
			const photosData = photosResponse.json;

			if (!photosData.success) {
			throw new Error(`Failed to load photos: ${JSON.stringify(photosData)}`);
            }
			const photosList = photosData.data?.list || [];
			return photosList;
		} catch (error) {
			console.error('[Synology Photos] Error fetching photos:', {
				error: error,
				message: error.message,
				person: personName,
				baseUrl: baseUrl
			});
			throw error;
		}
	}

	private async fetchPhotosByTag(tag: string, space: 'personal' | 'shared' = 'personal', offset: number = 0, limit: number = 1000): Promise<any[]> {
		const sid = await this.ensureLoggedIn();
		const baseUrl = this.getBaseUrl();

		const apiPrefix = space === 'shared' ? 'SYNO.FotoTeam' : 'SYNO.Foto';

		const tagListUrl = `${baseUrl}/webapi/entry.cgi`;
		const tagParams = new URLSearchParams({
			api: `${apiPrefix}.Browse.GeneralTag`,
			version: '1',
			method: 'list',
			offset: '0',
			limit: '1000',
			_sid: sid
		});

		try {
			const tagListFullUrl = `${tagListUrl}?${tagParams.toString()}`;
			
			const tagResponse = await requestUrl({ url: tagListFullUrl, method: 'GET' });
			
			const tagData = tagResponse.json;

			if (!tagData.success) {
				throw new Error(`Failed to load tags: ${JSON.stringify(tagData)}`);
			}

			const availableTags = tagData.data?.list?.map((t: any) => t.name) || [];
			
			const targetTag = tagData.data?.list?.find((t: any) => 
				t.name.toLowerCase() === tag.toLowerCase()
			);

			if (!targetTag) {
				throw new Error(`Tag "${tag}" not found. Available tags: ${availableTags.join(', ')}`);
			}

			const photosUrl = `${baseUrl}/webapi/entry.cgi`;
			const photosParams = new URLSearchParams({
				api: `${apiPrefix}.Browse.Item`,
				version: '1',
				method: 'list',
				general_tag_id: targetTag.id.toString(),
				additional: JSON.stringify(['thumbnail', 'resolution']),
				offset: offset.toString(),
				limit: limit.toString(),
				_sid: sid
			});

			const photosFullUrl = `${photosUrl}?${photosParams.toString()}`;
			
			const photosResponse = await requestUrl({ url: photosFullUrl, method: 'GET' });
			
			const photosData = photosResponse.json;

			if (!photosData.success) {
			throw new Error(`Failed to load photos: ${JSON.stringify(photosData)}`);
            }
			const photosList = photosData.data?.list || [];
			return photosList;
		} catch (error) {
			console.error('[Synology Photos] Error fetching photos:', {
				error: error,
				message: error.message,
				tag: tag,
				baseUrl: baseUrl
			});
			throw error;
		}
	}

	private getThumbnailUrl(photo: any, size: 'sm' | 'm' | 'xl' = 'xl', space: 'personal' | 'shared' = 'personal'): string {
		const baseUrl = this.getBaseUrl();
		const { id, additional } = photo;
		const cacheKey = additional?.thumbnail?.cache_key;

		if (!cacheKey) {
			return '';
		}

		const apiName = space === 'shared' ? 'SYNO.FotoTeam.Thumbnail' : 'SYNO.Foto.Thumbnail';

		return `${baseUrl}/webapi/entry.cgi?api=${apiName}&version=1&method=get&mode=download&id=${id}&type=unit&size=${size}&cache_key=${cacheKey}&_sid=${this.sessionId}`;
	}

	private async processSynologyPhotosBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	) {
		const lines = source.trim().split('\n');
		let tag = '';
		let person = '';
		let space: 'personal' | 'shared' = 'personal';
		let columns = 3;
		let size: 'sm' | 'm' | 'xl' = 'xl';
		let limit = 0;

		for (const line of lines) {
			const [key, value] = line.split(':').map(s => s.trim());
			if (key === 'tag') tag = value;
			if (key === 'person') person = value;
			if (key === 'space' && ['personal', 'shared'].includes(value)) space = value as 'personal' | 'shared';
			if (key === 'columns') columns = parseInt(value) || 3;
			if (key === 'limit') limit = parseInt(value) || 0;
			if (key === 'size' && ['sm', 'm', 'xl'].includes(value)) size = value as 'sm' | 'm' | 'xl';
		}

		if (!tag && !person) {
			el.createEl('div', { 
				text: 'Error: You must specify either tag or person (e.g. tag: travel or person: John)',
				cls: 'synology-photos-error'
			});
			return;
		}

		if (tag && person) {
			el.createEl('div', { 
				text: 'Error: You can use either tag or person, not both',
				cls: 'synology-photos-error'
			});
			return;
		}

		const container = el.createEl('div', { cls: 'synology-photos-container' });
		const loading = container.createEl('div', { 
			text: 'Loading photos...', 
			cls: 'synology-photos-loading' 
		});

		let currentOffset = 0;
		const fetchLimit = limit > 0 ? limit : 50;
		let grid: HTMLElement | null = null;
		let loadMoreBtn: HTMLButtonElement | null = null;

		const loadPhotos = async () => {
			try {
				if (loadMoreBtn) {
					loadMoreBtn.setText('Loading...');
					loadMoreBtn.disabled = true;
				}

				const photos = tag 
					? await this.fetchPhotosByTag(tag, space, currentOffset, fetchLimit)
					: await this.fetchPhotosByPerson(person, space, currentOffset, fetchLimit);

				if (currentOffset === 0 && photos.length === 0) {
					const filterType = tag ? `tag "${tag}"` : `person "${person}"`;
					loading.setText(`No photos with ${filterType} found`);
					return;
				}

				if (currentOffset === 0) {
					loading.remove();

					grid = container.createEl('div', { cls: 'synology-photos-grid' });
					grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
				}
				for (const photo of photos) {
					const photoContainer = grid!.createEl('div', { cls: 'synology-photo-item' });
					const img = photoContainer.createEl('img', { cls: 'synology-photo-img' });
					
					img.src = this.getThumbnailUrl(photo, size, space);
					img.alt = photo.filename || 'Synology Photo';
					img.title = photo.filename || '';

					img.addEventListener('click', () => {
						this.openPhotoModal(photo, space);
					});
				}

				currentOffset += photos.length;

				if (!loadMoreBtn) {
					loadMoreBtn = container.createEl('button', {
						text: 'Load more',
						cls: 'synology-photos-load-more'
					});
					loadMoreBtn.addEventListener('click', loadPhotos);
				} else {
					loadMoreBtn.setText('Load more');
					loadMoreBtn.disabled = false;
				}
				if (photos.length < fetchLimit) {
					loadMoreBtn.style.display = 'none';
				} else {
					loadMoreBtn.style.display = 'block';
				}

			} catch (error) {
				if (currentOffset === 0) {
					loading.setText(`Error: ${error.message}`);
					loading.addClass('synology-photos-error');
				} else {
					new Notice(`Error loading photos: ${error.message}`);
					if (loadMoreBtn) {
						loadMoreBtn.setText('Load more');
						loadMoreBtn.disabled = false;
					}
				}
			}
		};

		loadPhotos();
	}

	private openPhotoModal(photo: any, space: 'personal' | 'shared' = 'personal') {
		const modal = document.createElement('div');
		modal.addClass('synology-photo-modal');
		
		const modalContent = modal.createEl('div', { cls: 'synology-photo-modal-content' });
		const img = modalContent.createEl('img');
		
		const thumbnailUrl = this.getThumbnailUrl(photo, 'xl', space);
		img.src = thumbnailUrl;
		img.alt = photo.filename;

		const urlContainer = modalContent.createEl('div', { cls: 'synology-photo-url' });
		urlContainer.createEl('div', { text: photo.filename || 'Unknown', cls: 'synology-photo-filename' });
		const urlText = urlContainer.createEl('input', { 
			cls: 'synology-photo-url-input',
			attr: { 
				type: 'text',
				value: thumbnailUrl,
				readonly: 'readonly'
			}
		});

		urlText.addEventListener('click', (e) => {
			e.stopPropagation();
			urlText.select();
		});

		modal.addEventListener('click', () => {
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
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'Synology Photos Integration - Settings'});

		new Setting(containerEl)
			.setName('Synology URL')
			.setDesc('IP address or hostname of your Synology NAS (without protocol and port)')
			.addText(text => text
				.setPlaceholder('192.168.1.100')
				.setValue(this.plugin.settings.synologyUrl)
				.onChange(async (value) => {
					this.plugin.settings.synologyUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Use HTTPS')
			.setDesc('Enable HTTPS protocol')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useHttps)
				.onChange(async (value) => {
					this.plugin.settings.useHttps = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Port')
			.setDesc('Port for Synology Photos (default: 5001 for HTTPS, 5000 for HTTP)')
			.addText(text => text
				.setPlaceholder('5001')
				.setValue(this.plugin.settings.port.toString())
				.onChange(async (value) => {
					const port = parseInt(value);
					if (!isNaN(port)) {
						this.plugin.settings.port = port;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Username')
			.setDesc('Username for Synology')
			.addText(text => text
				.setPlaceholder('admin')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.setDesc('Password for Synology')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('••••••••')
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Test connection to Synology Photos')
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					try {
						await this.plugin['login']();
						new Notice('✓ Connection successful!');
					} catch (error) {
						new Notice(`✗ Connection error: ${error.message}`);
					}
				}));

		containerEl.createEl('h3', {text: 'Advanced'});

		new Setting(containerEl)
			.setName('Personal Space ID Offset')
			.setDesc('Offset for photo IDs in personal space (use if thumbnails show wrong images after import)')
			.addText(text => text
				.setPlaceholder('0')
				.setValue(this.plugin.settings.personalSpaceIdOffset.toString())
				.onChange(async (value) => {
					const offset = parseInt(value);
					if (!isNaN(offset)) {
						this.plugin.settings.personalSpaceIdOffset = offset;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Shared Space ID Offset')
			.setDesc('Offset for photo IDs in shared space (use if thumbnails show wrong images after import)')
			.addText(text => text
				.setPlaceholder('0')
				.setValue(this.plugin.settings.sharedSpaceIdOffset.toString())
				.onChange(async (value) => {
					const offset = parseInt(value);
					if (!isNaN(offset)) {
						this.plugin.settings.sharedSpaceIdOffset = offset;
						await this.plugin.saveSettings();
					}
				}));

		containerEl.createEl('h3', {text: 'Usage'});
		const usage = containerEl.createEl('div', {cls: 'synology-photos-usage'});
		usage.createEl('p', {text: 'Create a code block with type "synology-photos" in your note and set parameters:'});
		
		const codeExample = usage.createEl('pre');
		codeExample.createEl('code', {text: 
`\`\`\`synology-photos
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
\`\`\``
		});

		usage.createEl('p', {text: 'Parameters:'});
		const params = usage.createEl('ul');
		params.createEl('li', {text: 'tag: tag name in Synology Photos (use either tag or person)'});
		params.createEl('li', {text: 'person: person name in Synology Photos (use either tag or person)'});
		params.createEl('li', {text: 'space: personal or shared (default: personal)'});
		params.createEl('li', {text: 'columns: number of columns in grid (default: 3)'});
		params.createEl('li', {text: 'limit: maximum number of photos to display (default: all)'});
		params.createEl('li', {text: 'size: thumbnail size - sm, m, xl (default: xl)'});
	}
}
