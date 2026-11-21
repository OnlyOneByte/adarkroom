/**
 Module for triggering marketing messages
 @author mtownsend
 @since Jan 2021
*/

Events.Marketing = [{
  /* Play Penrose! */
  title: _('Penrose'),
  // in the room or outside, as every other event of the pool: on the town and trek tabs it was the only one
  // available, so it came at every event slot (3-6 min) instead of its share of the original's pool
  isAvailable: () => (Engine.activeModule == Room || Engine.activeModule == Outside) && !$SM.get('marketing.penrose'),
  scenes: {
    'start': {
      text: [
        _('a strange thrumming, pounding and crashing. visions of people and places, of a huge machine and twisting curves.'),
        _('inviting. it would be so easy to give in, completely.')
      ],
      notification: _('a strange thrumming, pounding and crashing. and then gone.'),
      blink: true,
      buttons: {
        'give in': {
          text: _('give in'),
          onClick: () => {
            $SM.set('marketing.penrose', true);
          },
          link: 'https://penrose.doublespeakgames.com/?utm_source=adarkroom&utm_medium=crosspromote&utm_campaign=event'
        },
        'ignore': {
          text: _('ignore it'),
          nextScene: 'end'
        }
      }
    }
  },
  audio: AudioLibrary.EVENT_NOISES_INSIDE
}];
