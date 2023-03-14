# Obsidian AI Commander Plugin 

<a href="https://www.buymeacoffee.com/yzh503" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 40px !important;width: 150px !important;" ></a>

**AI Commander** is an open-source AI connector that helps you write notes with the power of OpenAI APIs in conjunction with Bing search engine.

[OpenAI API key](https://platform.openai.com/account/api-keys) is required to use this plugin.

## Current Features

- Generate text from prompt, selected lines or current line.
- Generate image from prompt, selected lines or current line. 
- Generate audio transcript from the last audio file above the current line.
- Generate text in conjunction with search engine results. This allows the text model to work with Bing search engine. A [Bing Web Search API](https://www.microsoft.com/en-us/bing/apis/bing-web-search-api) key is required to use this feature.  
- Generate text in context of the **PDF** attachment embedded in the note. In this mode, it will not incorporate the search result.
- Use [Prompt Perfect](https://promptperfect.jina.ai/) to automatically improve prompts. Your prompts will be replaced by the improved one.
- Custom prompt commands for selected text and PDF. For example, add a command "Summarise the text" in the plugin settings, and it will appear as a command. Note that you need to **reload** the plugin by disabling and re-enabling it after changing the Custom Commands setting.

## Supported models

- OpenAI gpt-3.5-turbo
- OpenAI Whisper
- OpenAI image generation model

## How to use

Call out the command pallette and try the following commands: 

- AI Commander: Generate text from prompt
- AI Commander: Generate image from prompt
- AI Commander: Generate text from the current line
- AI Commander: Generate image from the current line
- AI Commander: Generate text from the selected text
- AI Commander: Generate image from the selected text
- AI Commander: Generate a transcript from the above audio
- AI Commander: Generate text from prompt in context of the above PDF
- AI Commander: Generate text from the current line in context of the above PDF
- AI Commander: Generate text from the selected text in context of the above PDF

## Install from Github 

1. Move `manifest.json` and `main.js` to `<vault>/.obsidian/plugins/obsidian-aicommander-plugin`
2. Refresh installed plugins
3. Enable AI Commander
