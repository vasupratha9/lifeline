'use strict';

/**
 * Rule-based answers used when Gemini is not configured or fails, so the
 * assistant is never silent in an emergency.
 */

const URGENT_PATTERN = /\b(trapped|stuck|injur\w*|bleed\w*|unconscious|(?:not|can'?t|cannot|can not|unable to|struggling to|hard to) breath\w*|breathless\w*|drown\w*|fire|smoke inside|collapsed?|heart attack|chest pain|seizure|heat ?stroke|faint\w*|help me|sos)\b/i;

function isUrgent(question) {
  return URGENT_PATTERN.test(question);
}

function fallbackAnswer(question, plan) {
  if (isUrgent(question)) {
    const first = plan.immediateActions[0] || 'Move to a safe place away from the danger.';
    return {
      answer: `This sounds urgent. Call ${plan.emergency.number} now. While you wait: ${first}`,
      urgent: true,
    };
  }
  const top = plan.checklist.slice(0, 3).map((item, i) => `${i + 1}. ${item.text}`).join(' ');
  return {
    answer: `The AI assistant is unavailable right now, so here are your top ${plan.hazardLabel.toLowerCase()} priorities: ${top}`,
    urgent: false,
  };
}

module.exports = { isUrgent, fallbackAnswer };
