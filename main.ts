import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting} from 'obsidian';
import { PromptModal } from "./modal";
import { Configuration, OpenAIApi, CreateImageRequestSizeEnum } from "openai";
import axios from 'axios';

interface AICommanderPluginSettings {
	model: string;
    apiKey: string;
    imgSize: string;
    useSearchEngine: boolean;
    searchEngine: string;
    bingSearchKey: string;
}

const DEFAULT_SETTINGS: AICommanderPluginSettings = {
	model: 'gpt-3.5-turbo',
    apiKey: '',
    imgSize: '256x256',
    useSearchEngine: false,
    searchEngine: 'bing',
    bingSearchKey: ''
}

export default class AICommanderPlugin extends Plugin {
	settings: AICommanderPluginSettings;

    async generateText(prompt: string) {

        if (prompt.length < 1 || prompt.length > 4096) return({
            success: false, 
            prompt: prompt, 
            text: 'Prompt needs to be longer than 1 and shorter than 4096 characters.'
        })

        if (this.settings.apiKey.length <= 1) return({
            success: false, 
            prompt: prompt, 
            text: 'OpenAI API Key is not provided.'
        })

        const configuration = new Configuration({
            apiKey: this.settings.apiKey,
        });
        const openai = new OpenAIApi(configuration);

        let completion;

        try {
            if (this.settings.useSearchEngine) {

                if (this.settings.bingSearchKey.length <= 1) return({
                    success: false, 
                    prompt: prompt, 
                    text: 'Bing Web Search API Key is not provided.'
                })
    
                const searchResult = await this.searchText(prompt);
                completion = await openai.createChatCompletion({
                    model: this.settings.model,
                    messages: [{
                        role: 'system',
                        content: 'As an assistant who can absorb web search results, your task is to incorporate information from a web search API into your answers when responding to questions. Your response should include the relevant information from the search results and provide attribution by mentioning the source of information with the url. Please note that you should be able to handle various types of questions and search queries. Your response should also be clear and concise while incorporating all relevant information from the search results.'
                    },
                    {
                        role: 'assistant',
                        content: JSON.stringify(searchResult)
                    },
                    {
                        role: 'user', 
                        content: prompt
                    }],
                });
            } else {
                completion = await openai.createChatCompletion({
                    model: this.settings.model,
                    messages: [{
                        role: 'user', 
                        content: prompt
                    }],
                });
            }
        } catch (error) {
            return({
                success: false, 
                prompt: prompt, 
                text: error
            });
        }

        const res = completion.data.choices[0].message
        let message;
        if (res == undefined) message = 'No response from Bing.';
        else message = res.content;

        return({
            success: true,
            text: message,
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

        try {
            const response = await openai.createImage({
                prompt: prompt,
                n: 1,
                size: this.settings.imgSize as CreateImageRequestSizeEnum,
                response_format: 'b64_json'
            });

            return({
                success: true, 
                prompt: prompt, 
                text: `![](data:image/png;base64,${response.data.data[0].b64_json})\n`
            })

        } catch (error) {
            return({
                success: false, 
                prompt: prompt, 
                text: error
            });
        }
    }

    async generateTranscript(audioBuffer: ArrayBuffer, filetype: string, path: string) {

        // Workaround for issue https://github.com/openai/openai-node/issues/77
        const baseUrl = 'https://api.openai.com/v1/audio/transcriptions';

        const blob = new Blob([audioBuffer]);

        const formData = new FormData();
        formData.append('file', blob, 'audio.' + filetype);
        formData.append('model', 'whisper-1');

        let result;

        await axios.post(baseUrl, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
                'Authorization': 'Bearer ' + this.settings.apiKey
            }
        }).then(response => {
            console.log(response.data);
            result = response.data.text;
          })
          .catch(error => {
            result = error.response.data.error.message;
        });

        return result;
    }

    findAudioFilePath(editor: Editor) {
        const position = editor.getCursor();
        const markdownText = editor.getRange({line: 0, ch: 0}, position);
        const regex = /!\[\[(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)\]\]/g;

        let filename = '';
        let result: RegExpExecArray | null;
        while ((result = regex.exec(markdownText)) !== null) {
            filename = result[0].slice(3, -2);
        }
        
        return filename;
    }

    async searchText(prompt: string) {
        const endpoint = 'https://api.bing.microsoft.com/v7.0/search';
        const subscriptionKey = this.settings.bingSearchKey;

        let values;
        await axios.get(endpoint, {
            headers: {
                'Ocp-Apim-Subscription-Key': subscriptionKey
            },
            params: {
                q: prompt,
            }
        })
        .then(response => {
            values = response.data.webPages.value;
        })
        .catch(error => {
            console.log(error);
        });

        return values;
    } 

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'prompt-text',
			name: 'Generate text from prompt',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const onSubmit = (prompt: string) => {
                    const position = editor.getCursor();
                    new Notice("Generating text...");  
                    this.generateText(prompt).then((value) => {
                        if (value.success) {
                            new Notice('Text Generated.');
                            editor.setLine(position.line, `${value.text}`);
                        } else {
                            new Notice(value.text);
                        }
                    });
                };
                new PromptModal(this.app, "", onSubmit).open();
			}
		});

        this.addCommand({
			id: 'prompt-text-line',
			name: 'Generate text from the current line',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const position = editor.getCursor();
                new Notice("Generating text...");  
                this.generateText(editor.getLine(position.line)).then((value) => {
                    if (value.success) {
                        new Notice('Text Generated.');
                        editor.setLine(position.line, `${value.prompt}\n\n${value.text}`);
                    } else {
                        new Notice(value.text);
                    }
                });
			}
		});

        this.addCommand({
			id: 'prompt-text-selected',
			name: 'Generate text from the selected text',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                new Notice("Generating text...");  
                this.generateText(selectedText).then((value) => {
                    if (value.success) {
                        new Notice('Text Generated.');
                        if (editor.getSelection() === value.prompt) {
                            editor.replaceSelection(`${value.prompt}\n\n${value.text}`);
                        } else {
                            editor.setLine(editor.lastLine(), `${value.prompt}\n\n${value.text}`);
                        }
                    } else {
                        new Notice(value.text);
                    }
                });
			}
		});

        this.addCommand({
			id: 'prompt-img',
			name: 'Generate an image from prompt',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const onSubmit = (prompt: string) => {
                    const position = editor.getCursor();
                    new Notice("Generating image...");  
                    this.generateImage(prompt).then((value) => {
                        if (value.success) {
                            new Notice('Image Generated.');
                            editor.setLine(position.line, `\n\n${value.text}`);
                        } else {
                            new Notice(value.text);
                        }
                    });
                };
                new PromptModal(this.app, "", onSubmit).open();
			}
		});

		this.addCommand({
			id: 'prompt-img-line',
			name: 'Generate an image from the current line',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const position = editor.getCursor();
                new Notice("Generating image...");  
                this.generateImage(editor.getLine(position.line)).then((value) => {
                    if (value.success) {
                        new Notice('Image Generated.');
                        editor.setLine(position.line, `${value.prompt}\n\n${value.text}`);
                    } else {
                        new Notice(value.text);
                    }
                });
			}
		});

        this.addCommand({
			id: 'prompt-img-selected',
			name: 'Generate an image from the selected text',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                new Notice("Generating image...");  
                this.generateImage(selectedText).then((value) => {
                    if (value.success) {
                        new Notice('Image Generated.');
                        if (editor.getSelection() === value.prompt) {
                            editor.replaceSelection(`${value.prompt}\n\n${value.text}`);
                        } else {
                            editor.setLine(editor.lastLine(), `${value.prompt}\n\n${value.text}`);
                        }
                    } else {
                        new Notice(value.text);
                    }
                });
			}
		});

        this.addCommand({
			id: 'audio-transcript',
			name: 'Generate a transcript from the above audio',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const position = editor.getCursor();
                const line = editor.getLine(position.line)
                const path = this.findAudioFilePath(editor);
                const fileType = path.split('.').pop();

                if (fileType === undefined) {
                    new Notice('No audio file found');
                    return;
                }
                this.app.vault.adapter.readBinary(path).then((audioBuffer) => {
                    new Notice("Generating transcript...");  
                    this.generateTranscript(audioBuffer, fileType, path).then((result) => {
                        new Notice('Transcript Generated.');
                        editor.setLine(position.line, `${line}\n\n${result}`);
                    });
                });
            
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
	}
}
