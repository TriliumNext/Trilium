# Installing Ollama
[Ollama](https://ollama.com/) can be installed in a variety of ways, and even runs [within a Docker container](https://hub.docker.com/r/ollama/ollama). Ollama will be noticeably quicker when running on a GPU (Nvidia, AMD, Intel), but it can run on CPU and RAM. To install Ollama without any other prerequisites, you can follow their [installer](https://ollama.com/download):

<figure class="image image_resized" style="width:50.49%;"><img style="aspect-ratio:785/498;" src="3_Installing Ollama_image.png" width="785" height="498"></figure><figure class="image image_resized" style="width:40.54%;"><img style="aspect-ratio:467/100;" src="Installing Ollama_image.png" width="467" height="100"></figure><figure class="image image_resized" style="width:55.73%;"><img style="aspect-ratio:1296/1011;" src="1_Installing Ollama_image.png" width="1296" height="1011"></figure>

After their installer completes, if you're on Windows, you should see an entry in the start menu to run it:

<figure class="image image_resized" style="width:66.12%;"><img style="aspect-ratio:1161/480;" src="2_Installing Ollama_image.png" width="1161" height="480"></figure>

Also, you should have access to the `ollama` CLI via Powershell or CMD:

<figure class="image image_resized" style="width:86.09%;"><img style="aspect-ratio:1730/924;" src="5_Installing Ollama_image.png" width="1730" height="924"></figure>

After Ollama is installed, you can go ahead and `pull` the models you want to use and run. Here's a command to pull my favorite tool-compatible model and embedding model as of April 2025:

```
ollama pull llama3.1:8b
ollama pull mxbai-embed-large
```

Also, you can make sure it's running by going to [http://localhost:11434](http://localhost:11434) and you should get the following response (port 11434 being the “normal” Ollama port):

<figure class="image"><img style="aspect-ratio:585/202;" src="4_Installing Ollama_image.png" width="585" height="202"></figure>

Now that you have Ollama up and running, have a few models pulled, you're ready to go to go ahead and start using Ollama as both a chat provider, and embedding provider!