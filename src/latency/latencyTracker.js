function startTimer() {

    return Date.now();

}

function endTimer(startTime) {

    const endTime = Date.now();

    const latency = endTime - startTime;

    return latency;

}

module.exports = {
    startTimer,
    endTimer
};