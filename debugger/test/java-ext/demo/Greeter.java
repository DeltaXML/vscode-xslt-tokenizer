package demo;

// called reflexively: xmlns:g="java:demo.Greeter"
public class Greeter {
    public static String greet(String name) {
        return "Hello, " + name;
    }
}
