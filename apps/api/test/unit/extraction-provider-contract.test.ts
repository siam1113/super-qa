import { ConfigService } from '@nestjs/config';
import { OpenAIExtractionProvider } from '../../src/modules/business/extraction-providers/openai-extraction.provider';
import { AnthropicExtractionProvider } from '../../src/modules/business/extraction-providers/anthropic-extraction.provider';
import { ExtractionProviderFactory } from '../../src/modules/business/extraction-providers/extraction-provider.factory';
import { parseValidationResponse } from '../../src/modules/business/extraction-providers/validation-response';

describe('extraction provider failure contract', () => {
  it.each(['{}', 'not JSON', '{"isValid":true,"confidence":101,"reason":"yes"}', '{"isValid":true,"confidence":-1,"reason":"yes"}', '{"isValid":true,"confidence":1e999,"reason":"yes"}'])('rejects malformed validation: %s', response => {
    expect(() => parseValidationResponse(response, 95)).toThrow();
  });

  it('never accepts a negative verdict with a high score', () => {
    expect(parseValidationResponse('{"isValid":false,"confidence":99,"reason":"not supported"}', 95).confidence).toBe(30);
  });

  it.each(['openai', 'anthropic', 'misspelled'])('fails configuration instead of switching silently: %s', provider => {
    const config = new ConfigService();
    jest.spyOn(config, 'get').mockImplementation(key => key === 'EXTRACTION_PROVIDER' ? provider : undefined);
    expect(() => new ExtractionProviderFactory(config)).toThrow();
  });

  it.each(['openai', 'anthropic'])('propagates transport errors and malformed responses: %s', name => {
    const provider = name === 'openai'
      ? new OpenAIExtractionProvider(new ConfigService({ OPENAI_API_KEY: 'test-only' }))
      : new AnthropicExtractionProvider(new ConfigService({ ANTHROPIC_API_KEY: 'test-only' }));
    const create = jest.fn().mockRejectedValue(new Error('provider offline'));
    Object.defineProperty(provider, 'client', { value: { chat: { completions: { create } }, messages: { create } } });
    const request = { text: 'Rule: Users must log in.', fullDocument: '# Requirements\nRule: Users must log in.\n- This is a supported requirement.', type: 'rule' as const };
    return (async () => {
      await expect(provider.validate(request)).rejects.toThrow('provider offline');
      create.mockResolvedValue({ choices: [{ message: { content: '{}' } }], content: [{ type: 'text', text: '{}' }] });
      await expect(provider.validate(request)).rejects.toThrow('Invalid extraction');
      const response = '{"isValid":true,"confidence":90,"reason":"explicit"}';
      create.mockResolvedValue({ choices: [{ message: { content: response } }], content: [{ type: 'text', text: response }],
        usage: { prompt_tokens: 100, completion_tokens: 20, input_tokens: 100, output_tokens: 20 } });
      expect((await provider.validate(request)).usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    })();
  });
});
