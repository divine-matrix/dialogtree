# Dialogtree

A lightweight, browser-based editor for creating dialogue trees and exporting
them as plain JSON for C# and Godot.

## Run

Open `index.html` in a modern browser. No build step, backend, or dependencies
are required. Changes are saved in the browser's local storage.

## Editing

- Drag nodes on the canvas to arrange the conversation.
- Select a node to edit its speaker, dialogue, start status, and responses.
- Each response can point to another node or end the conversation.
- The JSON preview updates as you edit. Use **Export JSON** to download a
  project, **Import** to open one, or the copy button to copy the JSON.

## JSON format

The export contains only portable dialogue data; editor canvas positions are
kept in local storage and are not included in the exported JSON:

```json
{
  "title": "The old lighthouse",
  "startNodeId": "node-1",
  "nodes": [
    {
      "id": "node-1",
      "speaker": "Mara",
      "text": "You made it.",
      "choices": [
        {
          "text": "What happened here?",
          "nextNodeId": "node-2"
        }
      ]
    }
  ]
}
```

This is standard JSON with string IDs and arrays, so it can be parsed with
`System.Text.Json` in C# or `JSON.parse_string()` in Godot. A choice with an
empty `nextNodeId` ends the conversation. Consumers can resolve a choice by
finding the node whose `id` matches its `nextNodeId`, starting at
`startNodeId`.

### C# (`System.Text.Json`)

```csharp
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

string json = File.ReadAllText("dialogue.json");
var dialogue = JsonSerializer.Deserialize<DialogueTree>(json);

public sealed class DialogueTree
{
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("startNodeId")] public string StartNodeId { get; set; } = "";
    [JsonPropertyName("nodes")] public List<DialogueNode> Nodes { get; set; } = new();
}

public sealed class DialogueNode
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("speaker")] public string Speaker { get; set; } = "";
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("choices")] public List<DialogueChoice> Choices { get; set; } = new();
}

public sealed class DialogueChoice
{
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("nextNodeId")] public string NextNodeId { get; set; } = "";
}
```

### Godot (GDScript)

```gdscript
var dialogue: Dictionary = JSON.parse_string(
    FileAccess.get_file_as_string("res://dialogue.json")
)
var start_id: String = dialogue["startNodeId"]
var nodes: Array = dialogue["nodes"]
```
