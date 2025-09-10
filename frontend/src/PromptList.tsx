import React from "react";
import { Button, Typography } from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  MenuOutlined,
} from "@ant-design/icons";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import TextArea from "antd/es/input/TextArea";
import { v4 as uuid } from "uuid";

const { Text } = Typography;

export interface Prompt {
  id: string;
  text: string;
}
export const newBlankPrompt = (): Prompt => ({ id: uuid(), text: "" });

interface Props {
  prompts: Prompt[];
  setPrompts: (p: Prompt[]) => void;
}

const PromptList: React.FC<Props> = ({ prompts, setPrompts }) => {
  // CRUD helpers
  const addPrompt = () => setPrompts([...prompts, newBlankPrompt()]);
  const removePrompt = (idx: number) =>
    setPrompts(prompts.filter((_, k) => k !== idx));
  const updatePrompt = (idx: number, v: string) =>
    setPrompts(
      prompts.map((p, k) => (k === idx ? { ...p, text: v } : p)),
    );

  // Drag and Drop handler 
  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return;
    const next = [...prompts];
    const [moved] = next.splice(r.source.index, 1);
    next.splice(r.destination.index, 0, moved);
    setPrompts(next);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="prompt-list">
        {(drop) => (
          <div ref={drop.innerRef} {...drop.droppableProps}>
            {prompts.map((prompt, idx) => (
              <Draggable
                key={prompt.id}
                draggableId={prompt.id}
                index={idx}
              >
                {(drag) => (
                  <div
                    ref={drag.innerRef}
                    {...drag.draggableProps}
                    style={{
                      marginBottom: 16,
                      ...drag.draggableProps.style,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        marginBottom: 4,
                        gap: 8,
                      }}
                    >
                      <span
                        {...drag.dragHandleProps}
                        style={{
                          cursor: "grab",
                          padding: 4,
                          fontSize: 16,
                          lineHeight: 1,
                        }}
                      >
                        <MenuOutlined />
                      </span>

                      <Text strong>{`Prompt ${idx + 1}`}</Text>

                      <div style={{ flex: 1 }} /> 

                      <Button
                        type="text"
                        icon={<DeleteOutlined />}
                        danger
                        onClick={() => removePrompt(idx)}
                        title="Delete prompt"
                      />
                    </div>

                    <TextArea
                      value={prompt.text}
                      onChange={(e) =>
                        updatePrompt(idx, e.target.value)
                      }
                      placeholder={`System prompt #${idx + 1}`}
                      style={{
                        width: "100%",
                        resize: "vertical",
                        minHeight: 90,
                      }}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {drop.placeholder}

            <Button
              block
              type="dashed"
              icon={<PlusOutlined />}
              onClick={addPrompt}
            >
              Add prompt
            </Button>
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
};

export default PromptList;
