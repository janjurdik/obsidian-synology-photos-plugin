# Synology Photos Integration

Obsidian plugin for integrating photos from Synology Photos into your notes.

## Features

- 🔐 Authentication via Synology Photos API
- 🏷️ Load photos by tags or persons
- 📷 Grid display of photos in notes
- 🎨 Responsive design
- 🖼️ Fullsize preview on click
- 🔄 Load more functionality
- 🌐 Support for personal and shared spaces

## Installation

1. Copy the folder to `.obsidian/plugins/synology-photos-integration`
2. Enable the plugin in Obsidian settings
3. Configure Synology URL, username and password in plugin settings

## Usage

Create a code block with type `synology-photos` in your note:

\`\`\`synology-photos
tag: travel
space: personal
columns: 3
size: xl
limit: 20
\`\`\`

### Parameters

- **tag**: Tag name in Synology Photos (use either tag or person)
- **person**: Person name in Synology Photos (use either tag or person)
- **space**: `personal` or `shared` (default: personal)
- **columns**: Number of columns in grid (default: 3)
- **limit**: Maximum number of photos to display (default: all)
- **size**: Thumbnail size - `sm`, `m`, `xl` (default: `xl`)

## Examples

### Basic usage by tag
\`\`\`synology-photos
tag: vacation
\`\`\`

### By person in shared space
\`\`\`synology-photos
person: John Doe
space: shared
columns: 4
\`\`\`

### Limited results
\`\`\`synology-photos
tag: family
limit: 20
columns: 4
size: m
\`\`\`

## Settings

Configure in plugin settings:

1. **Synology URL**: IP address or hostname of your NAS (e.g. `192.168.1.100`)
2. **Port**: Port for Synology Photos (default: 5001 for HTTPS)
3. **Username**: Your Synology account
4. **Password**: Your password
5. **Use HTTPS**: Enable for secure connection

After configuration, use the "Test connection" button to verify.

## Build

```bash
npm install
npm run build
```

## Development

```bash
npm run dev
```

## Support

For questions or issues, create an issue on GitHub.

## License

MIT
