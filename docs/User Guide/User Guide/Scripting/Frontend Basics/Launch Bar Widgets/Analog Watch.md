# Analog Watch
<figure class="image"><img style="aspect-ratio:1007/94;" src="Analog Watch_image.png" width="1007" height="94"></figure>

This is a more intricate example of a basic widget, which displays an analog watch in the launch bar. Unlike note-context aware widgets, basic widgets don't react to note navigation.

```javascript
const TPL = `
<div class="analog-watch" style="
    position: relative;
    height: 38px;
    width: 38px;
    border-radius: 50%;
    background: white;
    border: 2px solid #444;
    flex-shrink: 0;
">
    <!-- hour hand -->
    <div class="hand hour" style="
        position: absolute;
        left: 50%;
        top: 50%;
        width: 3px;
        height: 10px;
        background: #333;
        transform-origin: bottom center;
    "></div>

    <!-- minute hand -->
    <div class="hand minute" style="
        position: absolute;
        left: 50%;
        top: 50%;
        width: 2px;
        height: 13px;
        background: #111;
        transform-origin: bottom center;
    "></div>

    <!-- second hand -->
    <div class="hand second" style="
        position: absolute;
        left: 50%;
        top: 50%;
        width: 1px;
        height: 15px;
        background: red;
        transform-origin: bottom center;
    "></div>
</div>
`;

class AnalogWatchWidget extends api.BasicWidget {
    doRender() {        
        this.$widget = $(TPL);

        const hourHand   = this.$widget.find('.hand.hour')[0];
        const minuteHand = this.$widget.find('.hand.minute')[0];
        const secondHand = this.$widget.find('.hand.second')[0];

        const update = () => {
            const now = new Date();
            const sec  = now.getSeconds();
            const min  = now.getMinutes();
            const hour = now.getHours();

            const secDeg  = sec * 6;
            const minDeg  = min * 6 + sec * 0.1;
            const hourDeg = (hour % 12) * 30 + min * 0.5;

            secondHand.style.transform = `translate(-50%, -100%) rotate(${secDeg}deg)`;
            minuteHand.style.transform = `translate(-50%, -100%) rotate(${minDeg}deg)`;
            hourHand.style.transform   = `translate(-50%, -100%) rotate(${hourDeg}deg)`;
        };

        update();
        this._interval = setInterval(update, 1000);
    }

    cleanup() {
        if (this._interval) clearInterval(this._interval);
    }
}

module.exports = new AnalogWatchWidget();
```