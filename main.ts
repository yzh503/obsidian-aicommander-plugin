import { App, Editor, MarkdownView, normalizePath, Notice, Plugin, PluginSettingTab, Setting, loadPdfJs} from 'obsidian';
import { PromptModal } from "./modal";
import { Configuration, OpenAIApi, CreateImageRequestSizeEnum, ChatCompletionRequestMessage } from "openai";
import axios from 'axios';

interface AICommanderPluginSettings {
	model: string;
    apiKey: string;
    imgSize: string;
    useSearchEngine: boolean;
    searchEngine: string;
    bingSearchKey: string;
    usePromptPerfect: boolean;
    promptPerfectKey: string;
}

const DEFAULT_SETTINGS: AICommanderPluginSettings = {
	model: 'gpt-3.5-turbo',
    apiKey: '',
    imgSize: '256x256',
    useSearchEngine: false,
    searchEngine: 'bing',
    bingSearchKey: '',
    promptPerfectKey: '',
    usePromptPerfect: false,
}

export default class AICommanderPlugin extends Plugin {
	settings: AICommanderPluginSettings;

    async improvePrompt(prompt: string, targetModel: string) {
        const YOUR_GENERATED_SECRET = '9VFMTHCukRuT5WqOkAD1:8cde275ebde49165527e9c97ecc96abef1e34473458fe8f9f3ecad177a163538';

        const headers = {
        'x-api-key': `token ${YOUR_GENERATED_SECRET}`,
        'Content-Type': 'application/json'
        };

        const data = {
        data: {
            prompt: prompt,
            targetModel: targetModel
        }
        };

        const response = await axios.post('https://us-central1-prompt-ops.cloudfunctions.net/optimize', data, { headers })
  
        if ('promptOptimized' in response.data.result) return response.data.result.promptOptimized as string;
        else return prompt;
    }

    async generateText(prompt: string, contextPrompt?: string) {

        if (prompt.length < 1 ) throw new Error('Cannot find prompt.');

        if (this.settings.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

        const configuration = new Configuration({ apiKey: this.settings.apiKey });
        const openai = new OpenAIApi(configuration);

        let newPrompt = prompt;

        if (this.settings.usePromptPerfect) {
            newPrompt = await this.improvePrompt(prompt, 'chatgpt');
        }

        const messages = [];
        
        if (contextPrompt) {
            messages.push({
                role: 'user',
                content: contextPrompt
            });
        } else if (this.settings.useSearchEngine) {
            if (this.settings.bingSearchKey.length <= 1) throw new Error('Bing Search API Key is not provided.');
            const searchResult = await this.searchText(prompt)
            messages.push({
                role: 'user',
                content: 'As an assistant who can learn information from web search results, your task is to incorporate information from a web search API response into your answers when responding to questions. Your response should include the relevant information from the search API response and provide attribution by mentioning the source of information with the url. Please note that you should be able to handle various types of questions and search queries. Your response should also be clear and concise while incorporating all relevant information from the web search results. Here are the web search API response in JSON format: \n\n ' + JSON.stringify(searchResult)
            });
        } 

        messages.push({
            role: 'user', 
            content: newPrompt
        });

        const data = {
            model: this.settings.model,
            messages: messages as ChatCompletionRequestMessage[],
        };

        console.log('Completion request: ', data);

        const completion = await openai.createChatCompletion(data)

        const message = completion.data.choices[0].message
        if (!message) throw new Error('No response from OpenAI API');
        const content = message.content;

        return({
            text: content,
            prompt: prompt 
        });
    }

    async getImageBase64(url: string) {
        return fetch(url)
          .then(response => response.blob())
          .then(blob => {
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve(reader.result);
              };
              reader.onerror = () => {
                reject(new Error("Failed to convert image to base64"));
              };
              reader.readAsDataURL(blob);
            });
        });
    }

    async generateImage(prompt: string) {

        if (prompt.length > 1000) return({
            success: false, 
            prompt: prompt, 
            text: 'Prompt needs to be shorter than 1000 characters.'
        })

        const configuration = new Configuration({
            apiKey: this.settings.apiKey,
        });
        const openai = new OpenAIApi(configuration);

        let newPrompt = prompt;

        if (this.settings.usePromptPerfect) {
            newPrompt = await this.improvePrompt(prompt, 'dalle');
        }
        
        const response = await openai.createImage({
            prompt: newPrompt,
            n: 1,
            size: this.settings.imgSize as CreateImageRequestSizeEnum,
            response_format: 'b64_json'
        });

        const size = this.settings.imgSize.split('x')[0];

        return({
            prompt: prompt, 
            text: `![${size}](data:image/png;base64,${response.data.data[0].b64_json})\n`
        })
    }

    async generateTranscript(audioBuffer: ArrayBuffer, filetype: string) {

        // Workaround for issue https://github.com/openai/openai-node/issues/77
        const baseUrl = 'https://api.openai.com/v1/audio/transcriptions';

        const blob = new Blob([audioBuffer]);

        const formData = new FormData();
        formData.append('file', blob, 'audio.' + filetype);
        formData.append('model', 'whisper-1');

        return axios.post(baseUrl, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
                'Authorization': 'Bearer ' + this.settings.apiKey
            }
        }).then(response => response.data.text)
    }

    async searchText(prompt: string) {
        const response = await axios.get('https://api.bing.microsoft.com/v7.0/search', {
            headers: {
                'Ocp-Apim-Subscription-Key': this.settings.bingSearchKey
            },
            params: {
                q: prompt,
            }
        })

        return response.data.webPages.value;
    } 

    async getAttachmentDir() {
        const attachmentFolder = await this.app.vault.adapter.read(`${this.app.vault.configDir}/app.json`).then((content: string) => {
            const config = JSON.parse(content);
            if (config.attachmentFolderPath === '/' || config.attachmentFolderPath === './') {
                return '';
            }
            return config.attachmentFolderPath + '/' || '';
        });

        return attachmentFolder as string;
    }

    async findFilePath(text: string, regex: RegExp) {

        const path = await this.getAttachmentDir().then((path) => {
            let filename = '';
            let result: RegExpExecArray | null;
            while ((result = regex.exec(text)) !== null) {
                filename = decodeURI(result[0]);
            }

            if (filename.contains('/') || filename.contains('\\')) {
                return normalizePath(filename);
            } else {
                return normalizePath(path + filename);
            }
        });
        return path as string;
    }


    async generateTextWithPdf(prompt: string, filepath: string) {
        const pdfBuffer = await this.app.vault.adapter.readBinary(filepath);
        const pdfjs = await loadPdfJs();
        const pdf = await pdfjs.getDocument(pdfBuffer).promise;
        let totalContent = '';
        for (let i = 0; i < pdf.numPages; i++) {
            const page = await pdf.getPage(i + 1);
            const content = await page.getTextContent();
            const pageContent = content.items.map((item: any) => item.str).join(' ');
            totalContent += `Page ${i + 1}: ` + pageContent.replace(/\s+/g, ' ') + '\n';
        }

        const context = `As an assistant who can learn from text given to you, your task is to incorporate information from text given to you into your answers when responding to questions. Your response should include the relevant information from the text given to you and provide attribution by mentioning the page number. Everything below is the text, which is extracted from a PDF file: \n\n${totalContent}`

        return this.generateText(prompt, context);
    }

    processGeneratedText(editor: Editor, targetLine: number, data: any, includePrompt: boolean, hasSelected: boolean) {
        new Notice('Text Generated.');

        let newLine = '';
        if (includePrompt) newLine = `${data.prompt}\n\n${data.text.trimStart()}\n`;
        else newLine = `${data.text}\n`;

        const selectionNotChanged = editor.getSelection() === data.prompt;
        if (hasSelected && selectionNotChanged) editor.replaceSelection(newLine);
        else if (hasSelected && !selectionNotChanged) editor.setLine(editor.lastLine(), newLine);
        else if (!hasSelected) editor.setLine(targetLine, newLine);
        else throw new Error('Programmer error');

        editor.setCursor({line: targetLine + 1, ch: 0});
    }

    commandGenerateText(editor: Editor, prompt: string, includePrompt: boolean, hasSelected: boolean) {
        const position = editor.getCursor();
        new Notice("Generating text...");  
        this.generateText(prompt).then((data) => {
            this.processGeneratedText(editor, position.line, data, includePrompt, hasSelected);
        }).catch(error => {
            new Notice(error.message);
        });
    }

    commandGenerateTextWithPdf(editor: Editor, prompt: string, includePrompt: boolean, hasSelected: boolean) {
        const position = editor.getCursor();
        const text = editor.getRange({line: 0, ch: 0}, position);
        const regex = /(?<=\[(.*)]\()(([^[\]])+)\.pdf(?=\))/g;
        this.findFilePath(text, regex).then((path) => {
            new Notice(`Generating text in context of ${path}...`);  
            this.generateTextWithPdf(prompt, path).then((data) => {
                this.processGeneratedText(editor, position.line, data, includePrompt, hasSelected);
            })
        }).catch(error => {
            new Notice(error.message);
        });
    }

    commandGenerateImage(editor: Editor, prompt: string, includePrompt: boolean, hasSelected: boolean) {
        const position = editor.getCursor();
        new Notice("Generating image...");  
        this.generateImage(prompt).then((data) => {
            new Notice('Image Generated.');
            this.processGeneratedText(editor, position.line, data, includePrompt, hasSelected);
        }).catch(error => {
            new Notice(error.message);
        });
    }

    commandGenerateTranscript(editor: Editor) {
        const position = editor.getCursor();
        const line = editor.getLine(position.line)
        const text = editor.getRange({line: 0, ch: 0}, position);
        const regex = /(?<=\[(.*)]\()(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)(?=\))/g;
        this.findFilePath(text, regex).then((path) => {
            const fileType = path.split('.').pop();
            if (fileType == undefined || fileType == null || fileType == '') {
                new Notice('No audio file found');
                return;
            }
            this.app.vault.adapter.readBinary(path).then((audioBuffer) => {
                new Notice("Generating transcript...");  
                this.generateTranscript(audioBuffer, fileType).then((result) => {
                    new Notice('Transcript Generated.');
                    editor.setLine(position.line, `${line}${result}\n`);
                });
            })
        }).catch(error => {
            new Notice(error.message);
        });
    }

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'prompt-text',
			name: 'Generate text from prompt',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const onSubmit = (prompt: string) => {
                    this.commandGenerateText(editor, prompt, false, false);
                };
                new PromptModal(this.app, "", onSubmit).open();
			}
		});

        this.addCommand({
			id: 'prompt-img',
			name: 'Generate an image from prompt',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const onSubmit = (prompt: string) => {
                   this.commandGenerateImage(editor, prompt, false, false);
                };
                new PromptModal(this.app, "", onSubmit).open();
			}
		});

        this.addCommand({
			id: 'prompt-text-line',
			name: 'Generate text from the current line',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const position = editor.getCursor();
                const lineContent = editor.getLine(position.line);
                this.commandGenerateText(editor, lineContent, true, false);
			}
		});

        this.addCommand({
			id: 'prompt-img-line',
			name: 'Generate an image from the current line',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const position = editor.getCursor();
                const lineContent = editor.getLine(position.line);
                this.commandGenerateImage(editor, lineContent, true, false);
			}
		});

        this.addCommand({
			id: 'prompt-text-selected',
			name: 'Generate text from the selected text',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                this.commandGenerateText(editor, selectedText, true, true);
			}
		});

        this.addCommand({
			id: 'prompt-img-selected',
			name: 'Generate an image from the selected text',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                new Notice("Generating image...");  
                this.commandGenerateImage(editor, selectedText, true, true);
			}
		});

        this.addCommand({
			id: 'audio-transcript',
			name: 'Generate a transcript from the above audio',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                this.commandGenerateTranscript(editor);
			}  
		});

        this.addCommand({
			id: 'prompt-text',
			name: 'Generate text from prompt in context of the above PDF',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const onSubmit = (prompt: string) => {
                    this.commandGenerateTextWithPdf(editor, prompt, false, false);
                };
                new PromptModal(this.app, "", onSubmit).open();
			}
		});

        this.addCommand({
			id: 'pdf-text-line',
			name: 'Generate text from the current line in context of the above PDF',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const position = editor.getCursor();
                const lineCotent = editor.getLine(position.line)
                this.commandGenerateTextWithPdf(editor, lineCotent, true, false);
			}
		});

        this.addCommand({
			id: 'prompt-text-selected',
			name: 'Generate text from the selected text in context of the above PDF',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                this.commandGenerateTextWithPdf(editor, selectedText, true, true);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ApiSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ApiSettingTab extends PluginSettingTab {
	plugin: AICommanderPlugin;

	constructor(app: App, plugin: AICommanderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: 'Settings'});
        containerEl.createEl('h3', {text: 'OpenAI API'});
        
		new Setting(containerEl)
			.setName('OpenAI API key')
            .setDesc('For use of OpenAI models')
			.addText(text => text
				.setPlaceholder('Enter your key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));
        
        new Setting(containerEl)
            .setName('Text Model')
            .setDesc('Select the model to use for text generation')
            .addDropdown(dropdown => dropdown
                .addOption('gpt-3.5-turbo', 'gpt-3.5-turbo')
                .setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));
        
        new Setting(containerEl)
            .setName('Image Size')
            .setDesc('Size of the image to generate')
            .addDropdown(dropdown => dropdown
                .addOption('256x256', '256x256')
                .addOption('512x512', '512x512')
                .addOption('1024x1024', '1024x1024')
                .setValue(this.plugin.settings.imgSize)
				.onChange(async (value) => {
					this.plugin.settings.imgSize = value;
					await this.plugin.saveSettings();
				}));
        
        containerEl.createEl('h3', {text: 'Search Engine'});
        
        new Setting(containerEl)
            .setName('Use search engine')
            .setDesc("Use text generator with search engine")
            .addToggle(value => value
                .setValue(this.plugin.settings.useSearchEngine)
                .onChange(async (value) => {
                    this.plugin.settings.useSearchEngine = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Search engine')
            .setDesc("Select the search engine to use with text generator")
            .addDropdown(dropdown => dropdown
                .addOption('bing', 'bing')
                .setValue(this.plugin.settings.searchEngine)
                .onChange(async (value) => {
                    this.plugin.settings.searchEngine = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
			.setName('Bing Web Search API key')
            .setDesc("Find in 'manage keys' in Azure portal")
			.addText(text => text
				.setPlaceholder('Enter your key')
				.setValue(this.plugin.settings.bingSearchKey)
				.onChange(async (value) => {
					this.plugin.settings.bingSearchKey = value;
					await this.plugin.saveSettings();
				}));
        
        containerEl.createEl('h3', {text: 'Prompt Perfect'});

        new Setting(containerEl)
            .setName('Use Prompt Perfect')
            .setDesc("Use Prompt Perfect to improve prompts for text and image generation")
            .addToggle(value => value
                .setValue(this.plugin.settings.usePromptPerfect)
                .onChange(async (value) => {
                    this.plugin.settings.usePromptPerfect = value;
                    await this.plugin.saveSettings();
            }));
        
        
        new Setting(containerEl)
			.setName('Prompt Perfect API key')
            .setDesc("Find in Prompt Perfect settings")
			.addText(text => text
				.setPlaceholder('Enter your key')
				.setValue(this.plugin.settings.promptPerfectKey)
				.onChange(async (value) => {
					this.plugin.settings.promptPerfectKey = value;
					await this.plugin.saveSettings();
				}));
	}
}
