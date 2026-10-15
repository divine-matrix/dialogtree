# Dialogtree

A lightweight, browser-based editor for creating dialogue trees and exporting
them as plain JSON for C# and Godot.

## Run

Open `index.html` in a modern browser. No build step, backend, or dependencies
are required. Changes are saved in the browser's local storage.

## Editing

- Drag nodes on the canvas to arrange the conversation.
- Scroll the canvas to explore the expandable workspace. Use **Ctrl/Cmd+wheel**
  or the zoom controls to zoom, and click the zoom percentage to fit the nodes
  in view.
- Select a node to edit its speaker, dialogue, start status, and responses.
- Shift-click nodes or drag across empty canvas space to select multiple nodes.
- Drag any selected node to move the whole selection.
- Use `Ctrl/Cmd+C`, `Ctrl/Cmd+X`, and `Ctrl/Cmd+V` to copy, cut, and paste nodes.
- Use `Ctrl/Cmd+D` to duplicate, `Ctrl/Cmd+A` to select all, and `Delete` or
  `Backspace` to remove the selection. `Escape` clears the selection.
- Drag a response's dot on the node to another node to connect it. Drop the dot
  on empty canvas space to disconnect it and end that path.
- For a disconnected response, set an optional **C# action key** in the inspector
  to call a registered C# function when that response is selected.
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
        },
        {
          "text": "Open the door",
          "nextNodeId": "",
          "actionKey": "OpenLighthouseDoor"
        }
      ]
    }
  ]
}
```

This is standard JSON with string IDs and arrays, so it can be parsed with
`System.Text.Json` in C# or `JSON.parse_string()` in Godot. A choice with an
empty `nextNodeId` with no `actionKey` ends the conversation. Consumers can
resolve a choice by finding the node whose `id` matches its `nextNodeId`,
starting at `startNodeId`. A disconnected response can include an optional
`actionKey`; the editor exports it only when it is non-empty. The key is data,
not an arbitrary method invocation: register keys to functions in your C#
application.

### C# (`System.Text.Json`)

```csharp
using System;
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
    [JsonPropertyName("actionKey")] public string ActionKey { get; set; } = "";
}
```

When a chosen response has no `nextNodeId`, call
`DialogueActions.RunChoiceAction(choice)`. A non-empty, unregistered key
throws explicitly:

```csharp
public static class DialogueActions
{
    private static readonly IReadOnlyDictionary<string, Action> Handlers =
        new Dictionary<string, Action>
        {
            ["OpenLighthouseDoor"] = OpenLighthouseDoor
        };

    public static void RunChoiceAction(DialogueChoice choice)
    {
        if (string.IsNullOrWhiteSpace(choice.ActionKey))
            return;

        if (!Handlers.TryGetValue(choice.ActionKey, out var action))
            throw new InvalidOperationException($"No dialogue action is registered for '{choice.ActionKey}'.");

        action();
    }

    private static void OpenLighthouseDoor()
    {
        // Perform the game-specific action here.
    }
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
