import React, { useMemo } from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import SpeechBubble from './SpeechBubble';

interface UserUtteranceCellProps {
  fallbackText: string;
  canonical?: string;
  paraphrases?: any[]; // allow paraphrases to be strings or objects
}

// Helper to extract text from a paraphrase item.
const extractParaphraseText = (item: any): string => {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item.utterance) return item.utterance;
  return '';
};

const UserUtteranceCell: React.FC<UserUtteranceCellProps> = React.memo(
  ({ fallbackText, canonical, paraphrases }) => {
    // Pick the first paraphrase if it exists (and extract its text)
    const paraphraseText =
      paraphrases && paraphrases.length > 0
        ? extractParaphraseText(paraphrases[0])
        : null;

    const { textInBubble, showTooltip } = useMemo(() => {
      let textInBubble = '';
      let showTooltip = false;
      
      if (paraphraseText && canonical) {
        if (paraphraseText === canonical) {
          // If they are the same -> just show one text
          textInBubble = paraphraseText;
          showTooltip = false;
        } else {
          // Else if they differ -> show paraphrase in bubble, canonical in tooltip
          textInBubble = paraphraseText;
          showTooltip = true;
        }
      } else if (paraphraseText) {
        // If only paraphrase, no canonical
        textInBubble = paraphraseText;
        showTooltip = false;
      } else if (canonical) {
        // If only canonical, no paraphrase
        textInBubble = canonical;
        showTooltip = false;
      } else {
        // Neither paraphrase nor canonical -> fallback to original text
        textInBubble = fallbackText;
        showTooltip = false;
      }

      return { textInBubble, showTooltip };
    }, [paraphraseText, canonical, fallbackText]);

    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SpeechBubble variant="user">{textInBubble}</SpeechBubble>
        {showTooltip && canonical && (
          <Tooltip title={`Canonical: ${canonical}`}>
            <InfoCircleOutlined style={{ marginLeft: '8px', cursor: 'pointer' }} />
          </Tooltip>
        )}
      </div>
    );
  }
);

export default UserUtteranceCell;
