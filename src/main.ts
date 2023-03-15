import { App, Editor, MarkdownView, normalizePath, Notice, Plugin, PluginSettingTab, Setting, loadPdfJs, requestUrl, arrayBufferToBase64, TFolder} from 'obsidian';
import { PromptModal } from "./modal";
import { Configuration, OpenAIApi, CreateImageRequestSizeEnum, ChatCompletionRequestMessage } from "openai";
import { OpenAIClient } from '@fern-api/openai';

interface AICommanderPluginSettings {
	model: string;
    apiKey: string;
    imgSize: string;
    saveImg: string;
    useSearchEngine: boolean;
    searchEngine: string;
    bingSearchKey: string;
    usePromptPerfect: boolean;
    promptPerfectKey: string;
    promptsForSelected: string;
    promptsForPdf: string;
}

const DEFAULT_SETTINGS: AICommanderPluginSettings = {
	model: 'gpt-3.5-turbo',
    apiKey: '',
    imgSize: '256x256',
    saveImg: 'attachment',
    useSearchEngine: false,
    searchEngine: 'bing',
    bingSearchKey: '',
    promptPerfectKey: '',
    usePromptPerfect: false,
    promptsForSelected: '',
    promptsForPdf: ''
}

export default class AICommanderPlugin extends Plugin {
	settings: AICommanderPluginSettings;

    async improvePrompt(prompt: string, targetModel: string) {

        const data = {
            data: {
                prompt: prompt,
                targetModel: targetModel
            }
        };

        const params = {
            url: 'https://us-central1-prompt-ops.cloudfunctions.net/optimize',
            method: 'POST',
            contentType: 'application/json',
            body: JSON.stringify(data),
            headers: {
                'x-api-key': `token ${this.settings.promptPerfectKey}`,
            }
        }

        const response = await requestUrl(params);
  
        if ('promptOptimized' in response.json.result) return response.json.result.promptOptimized as string;
        else throw new Error('Prompt Perfect API: ' + JSON.stringify(response.json));
    }

    async generateText2(editor: Editor, prompt: string, lineToInsert: number, onFinish?: () => void, contextPrompt?: string) {
        if (prompt.length < 1 ) throw new Error('Cannot find prompt.');
        if (this.settings.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

        let newPrompt = prompt;

        if (this.settings.usePromptPerfect) {
            newPrompt = await this.improvePrompt(prompt, 'chatgpt');
        }

        const messages = [];
        
        if (contextPrompt) {
            messages.push({
                role: 'system',
                content: contextPrompt
            });
        } else if (this.settings.useSearchEngine) {
            if (this.settings.bingSearchKey.length <= 1) throw new Error('Bing Search API Key is not provided.');
            const searchResult = await this.searchText(prompt)
            messages.push({
                role: 'system',
                content: 'As an assistant who can learn information from web search results, your task is to incorporate information from a web search API JSON response into your answers when responding to questions. Your response should include the relevant information from the JSON and provide attribution by mentioning the source of information with its url in the format of markdown. Please note that you should be able to handle various types of questions and search queries. Your response should also be clear and concise while incorporating all relevant information from the web search results. Here are the web search API response in JSON format: \n\n ' + JSON.stringify(searchResult)
            });
        } 

        messages.push({
            role: 'user', 
            content: newPrompt
        });

        const client = new OpenAIClient({
            token: this.settings.apiKey,
        });
          
        let line = '';
        let message = '';
        let targetLine = lineToInsert;
        
        client.chat.createCompletion({
            model: this.settings.model,
            messages: messages as ChatCompletionRequestMessage[],
            stream: true,
        }, (data: any) => {
            const delta = data.choices[0].delta;
            if ('content' in delta) {
                const content = delta.content as string;
                message += content;
                console.log(message);
                while (message.includes('\n')) {
                    const newlineIndex = message.indexOf('\n');
                    if (newlineIndex >= 0) {
                        line = message.substring(0, newlineIndex + 1);
                        editor.setLine(targetLine, line.trim());
                        targetLine++;
                        message = message.substring(newlineIndex + 2);
                    }
                }
            }
        }, {
            onError: (error: any) => {
                throw new Error("Stream Error: " + JSON.stringify(error));
            },
            onFinish: onFinish,
        });
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
                role: 'system',
                content: contextPrompt
            });
        } else if (this.settings.useSearchEngine) {
            if (this.settings.bingSearchKey.length <= 1) throw new Error('Bing Search API Key is not provided.');
            const searchResult = await this.searchText(prompt)
            messages.push({
                role: 'system',
                content: 'As an assistant who can learn information from web search results, your task is to incorporate information from a web search API JSON response into your answers when responding to questions. Your response should include the relevant information from the JSON and provide attribution by mentioning the source of information with its url in the format of markdown. Please note that you should be able to handle various types of questions and search queries. Your response should also be clear and concise while incorporating all relevant information from the web search results. Here are the web search API response in JSON format: \n\n ' + JSON.stringify(searchResult)
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
        const buffer = await requestUrl(url).arrayBuffer;
        return arrayBufferToBase64(buffer);
    }

    async generateImage(prompt: string) {
        if (prompt.length < 1 ) throw new Error('Cannot find prompt.');
        if (this.settings.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

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

        const currentPathString = this.getCurrentPath();

        const filepath = await this.getAttachmentDir().then((attachmentPath) => {
            let dir = ''
            if (attachmentPath == '' || attachmentPath == '/') dir = '';
            else if (attachmentPath.startsWith('./')) dir = currentPathString + '/' + attachmentPath.substring(2);
            else dir = attachmentPath;

            const path = dir.trim() + '/' + this.generateRandomString(20) + '.png';
            return path.replace(/\/\//g, '/');
        }); 
        const base64 = response.data.data[0].b64_json as string;
        const buffer = Buffer.from(base64, 'base64');
        

        const fileDir = filepath.split('/')
        if (fileDir.length > 1) {
            fileDir.pop();
            const dirPath = fileDir.join('/');
            const exists = this.app.vault.getAbstractFileByPath(dirPath) instanceof TFolder;
            if(!exists) await this.app.vault.createFolder(dirPath);
        }

        await this.app.vault.createBinary(filepath, buffer);

        if (this.settings.saveImg == 'attachment') {
            return({
                prompt: prompt, 
                text: `![${size}](${encodeURI(filepath)})\n`
            });
        } else {
            return({
                prompt: prompt, 
                text: `![${size}](data:image/png;base64,${response.data.data[0].b64_json})\n`
            });
        }
    }

    async generateTranscript(audioBuffer: ArrayBuffer, filetype: string) {
        if (this.settings.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

        const baseUrl = 'https://api.openai.com/v1/audio/transcriptions';
        const blob = new Blob([audioBuffer]);
        const formData = new FormData();
        formData.append('file', blob, 'audio.' + filetype);
        formData.append('model', 'whisper-1');

        const params = {
            url: baseUrl,
            method: 'POST',
            contentType: 'multipart/form-data',
            body: JSON.stringify(formData),
            headers: {
                'Authorization': 'Bearer ' + this.settings.apiKey
            }
        }

        const text = await requestUrl(params).text;
        return text;
    }

    async searchText(prompt: string) {

        const params = {
            url: 'https://api.bing.microsoft.com/v7.0/search',
            method: 'GET',
            contentType: 'application/json',
            body: JSON.stringify({
                q: prompt, 
                count: 20
            }),
            headers: {
                'Ocp-Apim-Subscription-Key': this.settings.bingSearchKey
            }
        };
        const response = await requestUrl(params);
        if ('webPages' in response.json && 'value' in response.json.webPages) return response.json.webPages.value;
        else throw new Error('No web search results: ' + JSON.stringify(response.json));
    } 

    async getAttachmentDir() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) throw new Error('No active file');
        const dir = this.app.vault.getAvaiablePathForAttachments(activeFile.basename, activeFile?.extension, activeFile );
        return dir;
    }

    getCurrentPath() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) throw new Error('No active file');
        const currentPath = activeFile.path.split('/');
        currentPath.pop();
        const currentPathString = currentPath.join('/');
        return currentPathString;
    }

    async findFilePath(text: string, regex: RegExp[]) {
        const filepath = await this.getAttachmentDir().then((attachmentPath) => {
            let filename = '';
            let result: RegExpExecArray | null;
            for (const reg of regex) {
                while ((result = reg.exec(text)) !== null) {
                    filename = normalizePath(decodeURI(result[0])).trim();
                }
            }   

            if (filename == '') throw new Error('No file found in the text.');
            
            const currentPathString = this.getCurrentPath();

            console.log('currentPathString', currentPathString);
            console.log('attachmentPath', attachmentPath);
            console.log('filename', filename);
            
            const underRootFolder = attachmentPath === '' || attachmentPath === '/';
            const underCurrentFolder = attachmentPath.startsWith('./');
            const underSpecificFolder = !underCurrentFolder && !underRootFolder;
            const fileInSpecificFolder = filename.contains('/');

            console.log(underRootFolder, underCurrentFolder, underSpecificFolder, fileInSpecificFolder);

            let filepath = '';

            if (underRootFolder || fileInSpecificFolder) filepath = filename;
            if (underSpecificFolder) filepath = attachmentPath + '/' + filename;
            if (underCurrentFolder) {
                const attFolder = attachmentPath.substring(2);
                if (attFolder.length == 0) filepath = currentPathString + '/' + filename;
                else filepath = currentPathString + '/' + attFolder + '/' + filename;
            }

            return this.app.vault.adapter.exists(filepath).then((exists => {
                if (exists) return filepath;
                else {
                    let path = '';
                    let found = false;
                    this.app.vault.getFiles().forEach((file) => {
                        if (file.name === filename) {
                            path = file.path;
                            found = true;
                        }
                    });
                    if (found) return path;
                    else throw new Error('File not found');
                }
            }));
        });
        return filepath as string;
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

    generateRandomString(length: number): string {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const charactersLength = characters.length;
        let result = '';
      
        for (let i = 0; i < length; i++) {
          result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
      
        return result;
    }

    getNextEmptyLine(editor: Editor) {
        let line = editor.getCursor('to').line;
        while (editor.getLine(line).trim() !== '') line++;

        if (line == editor.lastLine()) {
            editor.setLine(line, editor.getLine(line) + '\n');
            line++;
        }

        return line;
    }

    processGeneratedText(editor: Editor, data: any, lineToInsert: number) {
        new Notice('Text Generated.');
        editor.setLine(lineToInsert, '\n\n' + data.text.trim() + '\n\n');
    }

    commandGenerateText(editor: Editor, prompt: string) {
        const lineToInsert = this.getNextEmptyLine(editor);
        new Notice("Generating text...");  
        this.generateText2(editor, prompt, lineToInsert, () => {
            new Notice('Text Generated.');
        }).catch(error => {
            console.log(error.message);
            new Notice(error.message);
        });
    }

    commandGenerateTextWithPdf(editor: Editor, prompt: string) {
        const lineToInsert = this.getNextEmptyLine(editor);
        const position = editor.getCursor();
        const text = editor.getRange({line: 0, ch: 0}, position);
        const regex = [/(?<=\[(.*)]\()(([^[\]])+)\.pdf(?=\))/g, 
            /(?<=\[\[)(([^[\]])+)\.pdf(?=]])/g];
        this.findFilePath(text, regex).then((path) => {
            console.log('path', path);
            new Notice(`Generating text in context of ${path}...`);  
            this.generateTextWithPdf(prompt, path).then((data) => {
                this.processGeneratedText(editor, data, lineToInsert);
            }).catch(error => {
                console.log(error.message);
                new Notice(error.message);
            });
        }).catch(error => {
            console.log(error.message);
            new Notice(error.message);
        });
    }

    commandGenerateImage(editor: Editor, prompt: string) {
        const lineToInsert = this.getNextEmptyLine(editor);
        new Notice("Generating image...");  
        this.generateImage(prompt).then((data) => {
            new Notice('Image Generated.');
            this.processGeneratedText(editor, data, lineToInsert);
        }).catch(error => {
            console.log(error.message);
            new Notice(error.message);
        });
    }

    commandGenerateTranscript(editor: Editor) {
        const position = editor.getCursor();
        const line = editor.getLine(position.line)
        const text = editor.getRange({line: 0, ch: 0}, position);
        const regex = [/(?<=\[\[)(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)(?=]])/g, 
            /(?<=\[(.*)]\()(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)(?=\))/g];
        this.findFilePath(text, regex).then((path) => {
            const fileType = path.split('.').pop();
            if (fileType == undefined || fileType == null || fileType == '') {
                new Notice('No audio file found');
            } else {
                this.app.vault.adapter.exists(path).then((exists) => {
                    console.log('Audio filepath', path);
                    if (!exists) throw new Error(path + ' does not exist');
                    this.app.vault.adapter.readBinary(path).then((audioBuffer) => {
                        new Notice("Generating transcript...");  
                        this.generateTranscript(audioBuffer, fileType).then((result) => {
                            new Notice('Transcript Generated.');
                            editor.setLine(position.line, `${line}${result}\n`);
                        });
                    }).catch(error => {
                        console.log(error.message);
                        new Notice(error.message);
                    });
                }).catch(error => {
                    console.log(error.message);
                    new Notice(error.message);
                });
            }
        }).catch(error => {
            console.log(error.message);
            new Notice(error.message);
        });
    }

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'text-prompt',
			name: 'Generate text from prompt',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const onSubmit = (prompt: string) => {
                    this.commandGenerateText(editor, prompt);
                };
                new PromptModal(this.app, "", onSubmit).open();
			}
		});

        this.addCommand({
			id: 'img-prompt',
			name: 'Generate an image from prompt',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const onSubmit = (prompt: string) => {
                   this.commandGenerateImage(editor, prompt);
                };
                new PromptModal(this.app, "", onSubmit).open();
			}
		});

        this.addCommand({
			id: 'text-line',
			name: 'Generate text from the current line',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const position = editor.getCursor();
                const lineContent = editor.getLine(position.line);
                this.commandGenerateText(editor, lineContent);
			}
		});

        this.addCommand({
			id: 'img-line',
			name: 'Generate an image from the current line',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const position = editor.getCursor();
                const lineContent = editor.getLine(position.line);
                this.commandGenerateImage(editor, lineContent);
			}
		});

        this.addCommand({
			id: 'text-selected',
			name: 'Generate text from the selected text',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                this.commandGenerateText(editor, selectedText);
			}
		});

        this.addCommand({
			id: 'img-selected',
			name: 'Generate an image from the selected text',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                new Notice("Generating image...");  
                this.commandGenerateImage(editor, selectedText);
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
			id: 'pdf-prompt',
			name: 'Generate text from prompt in context of the above PDF',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const onSubmit = (prompt: string) => {
                    this.commandGenerateTextWithPdf(editor, prompt);
                };
                new PromptModal(this.app, "", onSubmit).open();
			}
		});

        this.addCommand({
			id: 'pdf-line',
			name: 'Generate text from the current line in context of the above PDF',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const position = editor.getCursor();
                const lineCotent = editor.getLine(position.line)
                this.commandGenerateTextWithPdf(editor, lineCotent);
			}
		});

        this.addCommand({
			id: 'pdf-selected',
			name: 'Generate text from the selected text in context of the above PDF',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                this.commandGenerateTextWithPdf(editor, selectedText);
			}
		});

        const extraCommandsForSelected = this.settings.promptsForSelected.split('\n');
        for (let command of extraCommandsForSelected) {
            command = command.trim();
            if (command == null || command == undefined || command.length < 1) continue;
            const cid = command.toLowerCase().replace(/ /g, '-');
            this.addCommand({
                id: cid,
                name: command,
                editorCallback: (editor: Editor, view: MarkdownView) => {
                    const selectedText = editor.getSelection();
                    const prompt = 'You are an assistant who can learn from the text I give to you. Here is the text selected:\n\n' + selectedText + '\n\n' + command;
                    this.commandGenerateText(editor, prompt);
                }
            });
        }

        const extraCommandsForPdf = this.settings.promptsForPdf.split('\n');
        for (let command of extraCommandsForPdf) {
            command = command.trim();
            if (command == null || command == undefined || command.length < 1) continue;
            const cid = command.toLowerCase().replace(/ /g, '-');
            this.addCommand({
                id: cid,
                name: command,
                editorCallback: (editor: Editor, view: MarkdownView) => {
                    this.commandGenerateTextWithPdf(editor, command);
                }
            });
        }
    

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ApiSettingTab(this.app, this));

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
        containerEl.createEl('h2', {text: 'OpenAI API'});
        
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
        
        new Setting(containerEl)
            .setName('Image Format')
            .setDesc('Select how you want to save the image')
            .addDropdown(dropdown => dropdown
                .addOption('base64', 'base64')
                .addOption('attachment', 'attachment')
                .setValue(this.plugin.settings.saveImg)
				.onChange(async (value) => {
					this.plugin.settings.saveImg = value;
					await this.plugin.saveSettings();
				}));
        
        containerEl.createEl('h2', {text: 'Search Engine'});
        
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
        
        containerEl.createEl('h2', {text: 'Prompt Perfect'});

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

        containerEl.createEl('h2', {text: 'Custom Commands'}); 
        containerEl.createEl('p', {text: 'Reload the plugin after changing below settings'}); 

        new Setting(containerEl)
			.setName('Custom command for selected text')
            .setDesc('Fill in your prompts line by line. They will appear as commands.')
			.addTextArea(text => text
				.setPlaceholder('Summarise the text\nTranslate into English')
				.setValue(this.plugin.settings.promptsForSelected)
				.onChange(async (value) => {
					this.plugin.settings.promptsForSelected = value;
					await this.plugin.saveSettings();
				}));
        
        new Setting(containerEl)
			.setName('Custom command for PDF')
            .setDesc('Fill in your prompts line by line. They will appear as commands.')
			.addTextArea(text => text
				.setPlaceholder('Summarise the PDF')
				.setValue(this.plugin.settings.promptsForPdf)
				.onChange(async (value) => {
					this.plugin.settings.promptsForPdf = value;
					await this.plugin.saveSettings();
				}));
	}
}
