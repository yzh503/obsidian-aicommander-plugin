import {
  App,
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  loadPdfJs,
  requestUrl,
  arrayBufferToBase64,
  TFolder,
} from 'obsidian';
import { PromptModal } from './modal';
import { Configuration, OpenAIApi, CreateImageRequestSizeEnum } from 'openai';

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
  model: 'gpt-4o',
  apiKey: '',
  imgSize: '256x256',
  saveImg: 'attachment',
  useSearchEngine: false,
  searchEngine: 'bing',
  bingSearchKey: '',
  promptPerfectKey: '',
  usePromptPerfect: false,
  promptsForSelected: '',
  promptsForPdf: '',
};

export default class AICommanderPlugin extends Plugin {
  settings: AICommanderPluginSettings;
  writing: boolean;

  async improvePrompt(prompt: string, targetModel: string) {
    const data = {
      data: {
        prompt: prompt,
        targetModel: targetModel,
      },
    };

    const params = {
      url: 'https://us-central1-prompt-ops.cloudfunctions.net/optimize',
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify(data),
      headers: {
        'x-api-key': `token ${this.settings.promptPerfectKey}`,
      },
    };

    const response = await requestUrl(params);

    if ('promptOptimized' in response.json.result)
      return response.json.result.promptOptimized as string;
    else throw new Error('Prompt Perfect API: ' + JSON.stringify(response.json));
  }

  async generateText(prompt: string, editor: Editor, currentLn: number, contextPrompt?: string) {
    // Validate prompt and API key
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Prompt cannot be empty.');
    }

    if (!this.settings.apiKey || this.settings.apiKey.trim().length === 0) {
      throw new Error('OpenAI API Key is not provided.');
    }

    let finalPrompt = prompt;

    // Optionally improve the prompt
    if (this.settings.usePromptPerfect) {
      try {
        finalPrompt = await this.improvePrompt(prompt, 'chatgpt');
      } catch (error) {
        console.error('Prompt improvement failed:', error);
        // Proceed with the original prompt if improvement fails
      }
    }

    const messages: any[] = [];

    // Add context or search results if needed
    if (contextPrompt) {
      messages.push({ role: 'system', content: contextPrompt });
    } else if (this.settings.useSearchEngine) {
      try {
        const searchResult = await this.searchText(prompt);
        messages.push({
          role: 'system',
          content:
            'As an assistant who can learn information from web search results, your task is to incorporate information from a web search result into your answers when responding to questions. Your response should include the relevant information from your knowledge and the web search result and provide the source markdown URL of the information. Please note that you should be able to handle various types of questions and search queries. Your response should also be clear and concise while incorporating all relevant information from the web search results. Here are the web search result:\n\n' +
            JSON.stringify(searchResult),
        });
      } catch (error) {
        console.error('Search failed:', error);
        // Proceed without search results if search fails
      }
    }

    messages.push({ role: 'user', content: finalPrompt });

    // Prepare request body
    const requestBody = {
      model: this.settings.model,
      messages: messages,
      stream: true,
    };

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.settings.apiKey,
        },
      });

      if (!response.ok) {
        const errorResponse = await response.json();
        const errorMessage = errorResponse?.error?.message || response.statusText;
        throw new Error(`Error from OpenAI API: ${errorMessage}`);
      }
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    let lnToWrite = this.getNextNewLine(editor, currentLn);
    editor.replaceRange('\n', { line: lnToWrite, ch: 0 });
    lnToWrite++;

    const cursorPos = { line: lnToWrite, ch: 0 };
    let accumulatedText = '';
    const decoder = new TextDecoder('utf-8');
    let isDone = false;

    // Read and process streamed data
    while (!isDone) {
      const { value, done } = await reader.read();
      if (done) break;

      accumulatedText += decoder.decode(value, { stream: true });

      let parsedIndex;
      while ((parsedIndex = accumulatedText.indexOf('\n\n')) !== -1) {
        const chunk = accumulatedText.slice(0, parsedIndex).trim();
        accumulatedText = accumulatedText.slice(parsedIndex + 2);

        if (chunk === 'data: [DONE]') {
          isDone = true;
          break;
        }

        if (chunk.startsWith('data:')) {
          const jsonStr = chunk.substring('data:'.length).trim();
          if (jsonStr) {
            let json;
            try {
              json = JSON.parse(jsonStr);
            } catch (e) {
              console.error('JSON parse error:', e);
              continue;
            }

            if (json.error) {
              throw new Error('Error from OpenAI API: ' + json.error.message);
            }

            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              editor.replaceRange(content, cursorPos);

              const contentLines = content.split('\n');
              if (contentLines.length === 1) {
                cursorPos.ch += contentLines[0].length;
              } else {
                cursorPos.line += contentLines.length - 1;
                cursorPos.ch = contentLines[contentLines.length - 1].length;
              }

              editor.setCursor(cursorPos);
              editor.scrollIntoView({ from: cursorPos, to: cursorPos }, true);
            }
          }
        }
      }
    }
    editor.replaceRange('\n', cursorPos);
  }

  getNextNewLine(editor: Editor, line: number) {
    const isLastLine = line === editor.lastLine();
    const nextLineContent = editor.getLine(line + 1);
    if (isLastLine || (nextLineContent !== undefined && nextLineContent.trim().length > 0)) {
      editor.replaceRange('\n', { line, ch: editor.getLine(line).length });
    }
    return line + 1;
  }

  writeText(editor: Editor, LnToWrite: number, text: string) {
    const newLine = this.getNextNewLine(editor, LnToWrite);
    editor.setLine(newLine, text);
    return newLine;
  }

  async getImageBase64(url: string) {
    const buffer = await requestUrl(url).arrayBuffer;
    return arrayBufferToBase64(buffer);
  }

  generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async generateImage(prompt: string) {
    if (prompt.length < 1) throw new Error('Cannot find prompt.');
    if (this.settings.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

    const configuration = new Configuration({
      apiKey: this.settings.apiKey,
    });
    const openai = new OpenAIApi(configuration);

    let newPrompt = prompt;

    if (this.settings.usePromptPerfect) {
      newPrompt = await this.improvePrompt(prompt, 'dalle');
    }

    const response = await openai
      .createImage({
        prompt: newPrompt,
        n: 1,
        size: this.settings.imgSize as CreateImageRequestSizeEnum,
        response_format: 'b64_json',
      })
      .catch((error) => {
        if (error.response) {
          throw new Error(`Error. ${error.response.data.error.message}`);
        } else if (error.request) {
          throw new Error(`No response received!`);
        } else {
          throw new Error(`Error! ${error.message}`);
        }
      });

    const activeFile = this.app.workspace.getActiveFile();

    const size = this.settings.imgSize.split('x')[0];
    const filename = activeFile?.basename + '_' + this.generateRandomString(8) + '.png';
    const filepath = await this.app.vault.getAvailablePathForAttachments(filename);
    console.log(filename);
    console.log(filepath);
    const base64 = response.data.data[0].b64_json as string;
    const buffer = Buffer.from(base64, 'base64');

    const fileDir = filepath.split('/');
    if (fileDir.length > 1) {
      fileDir.pop();
      const dirPath = fileDir.join('/');
      const exists = this.app.vault.getAbstractFileByPath(dirPath) instanceof TFolder;
      if (!exists) await this.app.vault.createFolder(dirPath);
    }

    await this.app.vault.createBinary(filepath, buffer);

    if (this.settings.saveImg == 'attachment') {
      return `![${size}](${encodeURI(filepath)})\n`;
    } else {
      return `![${size}](data:image/png;base64,${response.data.data[0].b64_json})\n`;
    }
  }

  async generateTranscript(audioBuffer: ArrayBuffer, filetype: string) {
    if (!this.settings.apiKey || this.settings.apiKey.trim().length === 0) {
      throw new Error('OpenAI API Key is not provided.');
    }
  
    const mimeTypes: { [key: string]: string } = {
      flac: 'audio/flac',
      m4a: 'audio/x-m4a',
      mp3: 'audio/mpeg',
      mp4: 'audio/mp4',
      mpeg: 'audio/mpeg',
      mpga: 'audio/mpeg',
      oga: 'audio/ogg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      webm: 'audio/webm',
      mov: 'audio/quicktime',
    };
  
    const mimeType = mimeTypes[filetype.toLowerCase()] || 'application/octet-stream';
  
    const blob = new Blob([audioBuffer], { type: mimeType });

    const formData = new FormData();
    formData.append('file', blob, `audio.${filetype}`);
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + this.settings.apiKey,
      },
      body: formData,
    }).catch((error) => {
      console.error('Network error:', error);
      if (error.message.includes('401')) {
        throw new Error('OpenAI API Key is not valid.');
      } else {
        throw error;
      }
    });
  
    if (!response.ok) {
      const errorJson = await response.json();
      const errorMessage = errorJson?.error?.message || response.statusText;
      throw new Error(`${errorMessage}`);
    }
  
    const result = await response.json();
    if (result && 'text' in result) {
      return result.text;
    } else {
      throw new Error('Error: ' + JSON.stringify(result));
    }
  }

  async searchTextWithoutKey(query: string) {
    const params = {
      url: 'https://www.bing.com/search?q=' + encodeURIComponent(query),
      method: 'GET',
    };
    const response = await requestUrl(params);
    return response.text;
  }

  async searchTextWithKey(query: string) {
    const params = {
      url: 'https://api.bing.microsoft.com/v7.0/search?q=' + encodeURIComponent(query),
      method: 'GET',
      contentType: 'application/json',
      headers: {
        'Ocp-Apim-Subscription-Key': this.settings.bingSearchKey,
      },
    };

    const response = await requestUrl(params).catch((error) => {
      if (error.message.includes('401')) throw new Error('Bing Web Search API Key is not valid.');
      else throw error;
    });

    if ('webPages' in response.json && 'value' in response.json.webPages)
      return response.json.webPages.value;
    else throw new Error('No web search results: ' + JSON.stringify(response.json));
  }

  async searchText(query: string) {
    if (this.settings.bingSearchKey.length > 1) {
      return this.searchTextWithKey(query);
    } else {
      return this.searchTextWithoutKey(query);
    }
  }

  getCurrentPath() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) throw new Error('No active file');
    const currentPath = activeFile.path.split('/');
    currentPath.pop();
    const currentPathString = currentPath.join('/');
    return currentPathString;
  }

  async findFilePath(editor: Editor, regexList: RegExp[]): Promise<string> {
    const cursorPosition = editor.getCursor();
    const text = editor.getValue();

    let closestMatch: { index: number; length: number; linkText: string } | null = null;

    for (const regex of regexList) {
      regex.lastIndex = 0; // Reset regex index
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const matchStart = match.index;
        const matchEnd = regex.lastIndex;
        const matchLength = matchEnd - matchStart;

        // Check if this match is closer to the cursor
        if (
          !closestMatch ||
          Math.abs(matchStart - editor.posToOffset(cursorPosition)) <
            Math.abs(closestMatch.index - editor.posToOffset(cursorPosition))
        ) {
          closestMatch = {
            index: matchStart,
            length: matchLength,
            linkText: match[1] || match[0],
          };
        }
      }
    }

    if (!closestMatch) {
      throw new Error('No file link found near the cursor.');
    }

    const linkText = closestMatch.linkText;

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) throw new Error('No active file');

    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkText, activeFile.path);
    if (!linkedFile) {
      throw new Error(`File "${linkText}" not found in vault.`);
    }

    // Return the file path
    return linkedFile.path;
  }

  async generateTextWithPdf(prompt: string, editor: Editor, currentLn: number, filepath: string) {
    const pdfBuffer = await this.app.vault.adapter.readBinary(filepath);
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument(pdfBuffer).promise;

    const context =
      `As an assistant who can learn from text given to you, ` +
      `your task is to incorporate information from text given to you into your ` +
      `answers when responding to questions. Your response should include the ` +
      `relevant information from the text given to you and provide attribution ` +
      `by mentioning the page number. Below is the content, ` +
      `which is extracted from a PDF file:\n\n`;

    let message = context;

    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      const pageContent = content.items
        .map((item: any) => item.str)
        .filter((str: string) => str !== '')
        .join(' ')
        .replace(/\s+/g, ' ');
      message += `Page ${i + 1}: ` + pageContent + '\n';
    }

    return this.generateText(prompt, editor, currentLn, message);
  }

  commandGenerateText(editor: Editor, prompt: string) {
    const currentLn = editor.getCursor('to').line;
    if (this.writing) {
      new Notice('Generator is already in progress.');
      return;
    }
    this.writing = true;
    new Notice('Generating text...');
    this.generateText(prompt, editor, currentLn)
      .then((text) => {
        new Notice('Text completed.');
        this.writing = false;
      })
      .catch((error) => {
        console.log(error.message);
        new Notice(error.message);
        this.writing = false;
      });
  }

  commandGenerateTextWithPdf(editor: Editor, prompt: string) {
    const currentLn = editor.getCursor('to').line;
    const regexList = [
      /!\[\[(.+?\.pdf)\]\]/g, // Matches ![[File.pdf]]
      /!\[.*?\]\((.+?\.pdf)\)/g, // Matches ![Alt Text](File.pdf)
    ];
    this.findFilePath(editor, regexList)
      .then((path) => {
        if (this.writing) throw new Error('Generator is already in progress.');
        this.writing = true;
        new Notice(`Generating text in context of ${path}...`);
        this.generateTextWithPdf(prompt, editor, currentLn, path)
          .then((text) => {
            new Notice('Text completed.');
            this.writing = false;
          })
          .catch((error) => {
            console.log(error.message);
            new Notice(error.message);
            this.writing = false;
          });
      })
      .catch((error) => {
        console.log(error.message);
        new Notice(error.message);
      });
  }

  commandGenerateImage(editor: Editor, prompt: string) {
    const currentLn = editor.getCursor('to').line;
    if (this.writing) {
      new Notice('Generator is already in progress.');
      return;
    }
    this.writing = true;
    new Notice('Generating image...');
    this.generateImage(prompt)
      .then((text) => {
        this.writeText(editor, currentLn, text);
        new Notice('Image Generated.');
        this.writing = false;
      })
      .catch((error) => {
        console.log(error.message);
        new Notice(error.message);
        this.writing = false;
      });
  }

  commandGenerateTranscript(editor: Editor) {
    const position = editor.getCursor();
    const regexList = [
      /!\[\[(.+?\.(flac|m4a|mp3|mp4|mpeg|mpga|oga|ogg|wav|webm))\]\]/g, // Matches ![[File.mp3]]
      /!\[.*?\]\((.+?\.(flac|m4a|mp3|mp4|mpeg|mpga|oga|ogg|wav|webm))\)/g, // Matches ![Alt Text](File.mp3)
    ];
    this.findFilePath(editor, regexList)
      .then((path) => {
        const fileType = path.split('.').pop();
        if (fileType == undefined || fileType == null || fileType == '') {
          new Notice('No audio file found');
        } else {
          this.app.vault.adapter.exists(path).then((exists) => {
            if (!exists) throw new Error(path + ' does not exist');
            this.app.vault.adapter.readBinary(path).then((audioBuffer) => {
              if (this.writing) {
                new Notice('Already in progress.');
                return;
              }
              this.writing = true;
              new Notice('Generating transcript...');
              this.generateTranscript(audioBuffer, fileType)
                .then((result) => {
                  this.writeText(editor, position.line, result);
                  new Notice('Transcript Generated.');
                  this.writing = false;
                })
                .catch((error) => {
                  console.log(error.message);
                  new Notice(error.message);
                  this.writing = false;
                });
            });
          });
        }
      })
      .catch((error) => {
        console.log(error.message);
        new Notice(error.message);
      });
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
    .prompt-modal-textarea-container {
      margin-top: 10px;
      margin-bottom: 20px;
    }
    .prompt-modal-textarea {
      width: 100%;
      height: 100px;
      resize: vertical;
    }
    .prompt-modal-button-container {
      display: flex;
      justify-content: flex-end;
    }
    .prompt-modal-button-container button {
      margin-left: 10px;
    }
  `;
    document.head.appendChild(style);
  }

  async onload() {
    await this.loadSettings();
    this.writing = false;
    this.addStyles();

    this.addCommand({
      id: 'text-prompt',
      name: 'Generate text from prompt',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const onSubmit = (prompt: string) => {
          this.commandGenerateText(editor, prompt);
        };
        new PromptModal(this.app, '', onSubmit).open();
      },
    });

    this.addCommand({
      id: 'img-prompt',
      name: 'Generate an image from prompt',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const onSubmit = (prompt: string) => {
          this.commandGenerateImage(editor, prompt);
        };
        new PromptModal(this.app, '', onSubmit).open();
      },
    });

    this.addCommand({
      id: 'text-line',
      name: 'Generate text from the current line',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const position = editor.getCursor();
        const lineContent = editor.getLine(position.line);
        this.commandGenerateText(editor, lineContent);
      },
    });

    this.addCommand({
      id: 'img-line',
      name: 'Generate an image from the current line',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const position = editor.getCursor();
        const lineContent = editor.getLine(position.line);
        this.commandGenerateImage(editor, lineContent);
      },
    });

    this.addCommand({
      id: 'text-selected',
      name: 'Generate text from the selected text',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selectedText = editor.getSelection();
        this.commandGenerateText(editor, selectedText);
      },
    });

    this.addCommand({
      id: 'img-selected',
      name: 'Generate an image from the selected text',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selectedText = editor.getSelection();
        new Notice('Generating image...');
        this.commandGenerateImage(editor, selectedText);
      },
    });

    this.addCommand({
      id: 'audio-transcript',
      name: 'Generate a transcript from the above audio',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.commandGenerateTranscript(editor);
      },
    });

    this.addCommand({
      id: 'pdf-prompt',
      name: 'Generate text from prompt in context of the above PDF',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const onSubmit = (prompt: string) => {
          this.commandGenerateTextWithPdf(editor, prompt);
        };
        new PromptModal(this.app, '', onSubmit).open();
      },
    });

    this.addCommand({
      id: 'pdf-line',
      name: 'Generate text from the current line in context of the above PDF',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const position = editor.getCursor();
        const lineCotent = editor.getLine(position.line);
        this.commandGenerateTextWithPdf(editor, lineCotent);
      },
    });

    this.addCommand({
      id: 'pdf-selected',
      name: 'Generate text from the selected text in context of the above PDF',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selectedText = editor.getSelection();
        this.commandGenerateTextWithPdf(editor, selectedText);
      },
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
          const prompt =
            'You are an assistant who can learn from the text I give to you. Here is the text selected:\n\n' +
            selectedText +
            '\n\n' +
            command;
          this.commandGenerateText(editor, prompt);
        },
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
        },
      });
    }

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new ApiSettingTab(this.app, this));

    // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
    this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
  }

  onunload() {}

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
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'OpenAI API' });

    new Setting(containerEl)
      .setName('OpenAI API key')
      .setDesc('For use of OpenAI models')
      .addText((text) =>
        text
          .setPlaceholder('Enter your key')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Select the model to use for content generation')
      .addText((text) =>
        text
          .setPlaceholder('gpt-3.5-turbo')
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Image Size')
      .setDesc('Size of the image to generate')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('256x256', '256x256')
          .addOption('512x512', '512x512')
          .addOption('1024x1024', '1024x1024')
          .setValue(this.plugin.settings.imgSize)
          .onChange(async (value) => {
            this.plugin.settings.imgSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Image Format')
      .setDesc('Select how you want to save the image')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('base64', 'base64')
          .addOption('attachment', 'attachment')
          .setValue(this.plugin.settings.saveImg)
          .onChange(async (value) => {
            this.plugin.settings.saveImg = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h2', { text: 'Search Engine' });
    containerEl.createEl('p', {
      text: 'You may use Bing without an API key. Use an API key to achieve the best performance.',
    });

    new Setting(containerEl)
      .setName('Use search engine')
      .setDesc('Use text generator with search engine')
      .addToggle((value) =>
        value.setValue(this.plugin.settings.useSearchEngine).onChange(async (value) => {
          this.plugin.settings.useSearchEngine = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Search engine')
      .setDesc('Select the search engine to use with text generator')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('bing', 'bing')
          .setValue(this.plugin.settings.searchEngine)
          .onChange(async (value) => {
            this.plugin.settings.searchEngine = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Bing Web Search API key')
      .setDesc("Find in 'manage keys' in Azure portal")
      .addText((text) =>
        text
          .setPlaceholder('Enter your key')
          .setValue(this.plugin.settings.bingSearchKey)
          .onChange(async (value) => {
            this.plugin.settings.bingSearchKey = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h2', { text: 'Prompt Perfect' });

    new Setting(containerEl)
      .setName('Use Prompt Perfect')
      .setDesc('Use Prompt Perfect to improve prompts for text and image generation')
      .addToggle((value) =>
        value.setValue(this.plugin.settings.usePromptPerfect).onChange(async (value) => {
          this.plugin.settings.usePromptPerfect = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Prompt Perfect API key')
      .setDesc('Find in Prompt Perfect settings')
      .addText((text) =>
        text
          .setPlaceholder('Enter your key')
          .setValue(this.plugin.settings.promptPerfectKey)
          .onChange(async (value) => {
            this.plugin.settings.promptPerfectKey = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h2', { text: 'Custom Commands' });
    containerEl.createEl('p', { text: 'Reload the plugin after changing below settings' });

    new Setting(containerEl)
      .setName('Custom command for selected text')
      .setDesc('Fill in text generator prompts line by line. They will appear as commands.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Summarise the text\nTranslate into English')
          .setValue(this.plugin.settings.promptsForSelected)
          .onChange(async (value) => {
            this.plugin.settings.promptsForSelected = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Custom command for PDF')
      .setDesc('Fill in text generator prompts line by line. They will appear as commands.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Summarise the PDF')
          .setValue(this.plugin.settings.promptsForPdf)
          .onChange(async (value) => {
            this.plugin.settings.promptsForPdf = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
