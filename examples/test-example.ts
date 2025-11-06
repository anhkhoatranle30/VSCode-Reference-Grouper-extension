// Example TypeScript file to test the Reference Grouper extension
// Try: Place cursor on 'counter' and press Shift+F12 to see grouped references

let counter = 0; // Definition

// Write references (mutations):
counter = 5;           // Assignment
counter += 10;         // Compound assignment
counter++;             // Increment
counter--;             // Decrement
counter *= 2;          // Multiplication assignment

function incrementCounter() {
    counter = counter + 1;  // Write: assignment
}

function doubleCounter() {
    counter *= 2;  // Write: compound assignment
}

// Read references (no mutation):
console.log(counter);           // Read
const value = counter;          // Read
if (counter > 0) {              // Read
    console.log('Positive');
}

function getCounter() {
    return counter;             // Read
}

const result = counter + 100;   // Read

// Mixed example with array
const numbers = [1, 2, 3];

numbers.push(4);                // Write: mutation
numbers[0] = 10;                // Write: assignment
const first = numbers[0];       // Read
console.log(numbers.length);    // Read

// Object example
const person = {
    name: 'Alice',
    age: 30
};

person.age = 31;                // Write: property assignment
person.name = 'Bob';            // Write: property assignment
console.log(person.name);       // Read: property access
const personAge = person.age;   // Read: property access

// Try testing with other symbols too!
export { counter, numbers, person };
